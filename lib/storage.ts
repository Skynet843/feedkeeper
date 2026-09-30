import { browser } from 'wxt/browser';
import { BUILTIN_CATEGORIES, CUSTOM_GROUP, migrateCategoryIds, REPLACED_BY, SPLIT_FROM } from './categories';
import type { CorrectionEntry, DayStats, DecisionHistoryEntry, FilterProfile, FilterSnapshot, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'preview',
  apiKey: '',
  model: 'jev-1.13',
  threshold: 0.75,
  filterDirection: 'block',
  matchMethod: 'combined',
  categories: BUILTIN_CATEGORIES,
  allowlist: [],
  blocklist: [],
  allowedKeywords: [],
  blockedKeywords: [],
  alwaysShowVideos: [],
  alwaysHideVideos: [],
  surfaces: { home: true, watch: true },
  blockShorts: false,
  uncertainBehavior: 'show',
  uncertainMargin: 0.2,
  historyEnabled: true,
  profiles: [],
  pacing: { minDelayMs: 1500, maxDelayMs: 4000, maxPerMinute: 20, maxPerSession: 100 },
  useDescription: true,
};

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const { [SETTINGS_KEY]: stored } = await browser.storage.local.get(SETTINGS_KEY);
  const s = (stored ?? {}) as Partial<Settings>;
  let next: Settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    pacing: { ...DEFAULT_SETTINGS.pacing, ...s.pacing },
    surfaces: { ...DEFAULT_SETTINGS.surfaces, ...s.surfaces },
    categories: mergeCategories(s.categories),
  };
  // A focus session is a temporary applied profile. Restore the previous filter once it expires.
  if (next.focusSession && next.focusSession.until <= Date.now()) {
    next = { ...next, ...restoredFilter(next, next.focusSession.restore) };
    await browser.storage.local.set({ [SETTINGS_KEY]: next });
  }
  return next;
}

function restoredFilter(current: Settings, restore: FilterSnapshot): Partial<Settings> {
  const ids = migrateCategoryIds(restore.categoryIds);
  return {
    filterDirection: restore.filterDirection,
    threshold: restore.threshold,
    categories: current.categories.map((c) => ({ ...c, enabled: ids.includes(c.id) })),
    ...(restore.mode && { mode: restore.mode }),
    focusSession: undefined,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function applyProfile(profile: FilterProfile, minutes?: number): Promise<Settings> {
  const current = await getSettings();
  const focusSession = minutes
    ? {
        until: Date.now() + minutes * 60_000,
        profileName: profile.name,
        // Starting a session during another keeps the original filter to return to.
        restore: current.focusSession?.restore ?? {
          filterDirection: current.filterDirection,
          threshold: current.threshold,
          categoryIds: current.categories.filter((c) => c.enabled).map((c) => c.id),
          mode: current.mode,
        },
      }
    : undefined;
  const ids = migrateCategoryIds(profile.categoryIds);
  return saveSettings({
    filterDirection: profile.filterDirection,
    threshold: profile.threshold,
    categories: current.categories.map((c) => ({ ...c, enabled: ids.includes(c.id) })),
    focusSession,
    ...(profile.filterDirection === 'allow' && current.mode === 'auto' ? { mode: 'hide' as const } : {}),
  });
}

export async function stopFocusSession(): Promise<Settings> {
  const current = await getSettings();
  if (!current.focusSession) return current;
  return saveSettings(restoredFilter(current, current.focusSession.restore));
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && SETTINGS_KEY in changes) void getSettings().then(cb);
  });
}

/**
 * Keeps the user's selections, edited definitions and custom categories,
 * and picks up builtins added in later versions.
 */
function mergeCategories(stored: Settings['categories'] | undefined): Settings['categories'] {
  if (!stored) return BUILTIN_CATEGORIES;
  const byId = new Map(stored.map((c) => [c.id, c]));
  const builtinIds = new Set(BUILTIN_CATEGORIES.map((b) => b.id));
  const builtins = BUILTIN_CATEGORIES.map((b) => {
    const s = byId.get(b.id);
    // A retired category passes its selection to what replaced it, and a split-off category that these
    // settings have never seen follows the one it came from, rather than its own default.
    const sources = stored.filter(
      (c) => (c.builtin && !builtinIds.has(c.id) && REPLACED_BY[c.id]?.includes(b.id)) || (!s && SPLIT_FROM[b.id] === c.id),
    );
    return {
      ...b,
      enabled: s || sources.length ? [s, ...sources].some((c) => c?.enabled) : b.enabled,
      // Only a definition the user edited overrides ours; otherwise pick up improved builtin text.
      ...(s?.customized && { description: s.description, customized: true }),
    };
  });
  // A retired builtin the user had rewritten is kept as a custom category rather than silently dropped.
  const retiredEdits = stored
    .filter((c) => c.builtin && c.customized && !builtinIds.has(c.id))
    .map((c) => ({ ...c, id: `custom_${c.id}`, builtin: false, customized: undefined }));
  const custom = [...stored.filter((c) => !c.builtin), ...retiredEdits].map((c) => ({ ...c, group: CUSTOM_GROUP }));
  return [...builtins, ...custom];
}

const today = () => new Date().toISOString().slice(0, 10);
const statsKey = () => `stats:${today()}`;
const EMPTY_STATS: DayStats = { scanned: 0, matched: 0, actioned: 0, requests: 0, inputTokens: 0, costUsd: 0 };
const HISTORY_KEY = 'decisionHistory';
const HISTORY_LIMIT = 200;
const CORRECTIONS_KEY = 'corrections';
const CORRECTIONS_LIMIT = 500;

export async function getTodayStats(): Promise<DayStats> {
  const key = statsKey();
  const { [key]: s } = await browser.storage.local.get(key);
  return { ...EMPTY_STATS, ...(s as Partial<DayStats> | undefined) };
}

// Stats writes come from concurrent classify calls, so they are serialized to avoid lost updates.
let statsChain: Promise<unknown> = Promise.resolve();
export function bumpStats(delta: Partial<DayStats>): Promise<void> {
  const run = statsChain.then(async () => {
    const s = await getTodayStats();
    for (const [k, v] of Object.entries(delta) as [keyof DayStats, number][]) s[k] += v;
    await browser.storage.local.set({ [statsKey()]: s });
  });
  statsChain = run.catch(() => {});
  return run;
}

let historyChain: Promise<unknown> = Promise.resolve();
export function recordDecision(entry: DecisionHistoryEntry): Promise<void> {
  const run = historyChain.then(async () => {
    const { [HISTORY_KEY]: raw } = await browser.storage.local.get(HISTORY_KEY);
    const history = (raw as DecisionHistoryEntry[] | undefined) ?? [];
    await browser.storage.local.set({ [HISTORY_KEY]: [entry, ...history.filter((x) => x.videoId !== entry.videoId)].slice(0, HISTORY_LIMIT) });
  });
  historyChain = run.catch(() => {});
  return run;
}

export async function getDecisionHistory(): Promise<DecisionHistoryEntry[]> {
  const { [HISTORY_KEY]: raw } = await browser.storage.local.get(HISTORY_KEY);
  return (raw as DecisionHistoryEntry[] | undefined) ?? [];
}

export async function clearDecisionHistory(): Promise<void> {
  await browser.storage.local.remove(HISTORY_KEY);
}

let correctionsChain: Promise<unknown> = Promise.resolve();
export function recordCorrection(entry: CorrectionEntry): Promise<void> {
  const run = correctionsChain.then(async () => {
    const list = await getCorrections();
    await browser.storage.local.set({ [CORRECTIONS_KEY]: [entry, ...list.filter((x) => x.videoId !== entry.videoId)].slice(0, CORRECTIONS_LIMIT) });
  });
  correctionsChain = run.catch(() => {});
  return run;
}

export async function getCorrections(): Promise<CorrectionEntry[]> {
  const { [CORRECTIONS_KEY]: raw } = await browser.storage.local.get(CORRECTIONS_KEY);
  return (raw as CorrectionEntry[] | undefined) ?? [];
}

export async function clearCorrections(): Promise<void> {
  await browser.storage.local.remove(CORRECTIONS_KEY);
}
