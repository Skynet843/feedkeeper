import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { clickNotInterested } from '@/lib/actions';
import { categoriesToScore, SELECTION_SCORE_ID } from '@/lib/categories';
import { fetchDetails } from '@/lib/details';
import { extractVideo } from '@/lib/extract';
import { PacedQueue } from '@/lib/queue';
import { SEL } from '@/lib/selectors';
import { getSettings, onSettingsChanged, recordCorrection, recordDecision, saveSettings } from '@/lib/storage';
import type { ClassifyResponse, Message, Scores, Settings, VideoMeta } from '@/lib/types';
import './style.css';

const LOG = '[FeedKeeper]';
const RETRY_ERROR_AFTER_MS = 30_000;
/** Quiet period after the last category change before the feed is re-scored. */
const RESCORE_DELAY_MS = 1500;
/** Every tile we may have decorated, on any page. */
const ALL_TILES = `${SEL.homeBrowse} ${SEL.tile}, ${SEL.watchSidebar} :is(${SEL.sidebarTile})`;

type Page = 'home' | 'watch';
function currentPage(): Page | null {
  if (location.pathname === '/') return 'home';
  if (location.pathname === '/watch') return 'watch';
  return null;
}

/** Tiles on the current page: the home grid, or the watch page's "Up next" recommendations. */
function pageTiles(page: Page): Element[] {
  if (page === 'home') return [...(document.querySelector(SEL.homeBrowse)?.querySelectorAll(SEL.tile) ?? [])];
  return [...document.querySelectorAll(`${SEL.watchSidebar} :is(${SEL.sidebarTile})`)];
}

interface TileState {
  video: VideoMeta;
  status: 'pending' | 'scored' | 'error';
  scores?: Scores;
  errorAt?: number;
  error?: string;
  /** Set once the tile has been queued for "Not interested", so it's queued only once. */
  queued?: boolean;
  revealed?: boolean;
  /** On-demand category inspector state, kept across re-renders. */
  inspectorOpen?: boolean;
  inspectorShowAll?: boolean;
  inspectorLoading?: boolean;
  inspectorError?: string;
  inspectionScores?: Scores;
  localDecision?: { filter: boolean; reason: string };
  /** Whether render() left an overlay on the tile, so scan() can restore it if YouTube wipes it. */
  decorated?: boolean;
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  async main() {
    let settings = await getSettings();
    const tiles = new WeakMap<Element, TileState>();
    const countedScans = new Set<string>();
    const countedMatches = new Set<string>();
    const recordedDecisions = new Set<string>();
    const queue = new PacedQueue(() => settings.pacing);
    const pill = new StatusPill();
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    /** Set while a category change is waiting to be re-scored; current scores belong to the old selection. */
    let rescoreTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleFocusExpiry(): void {
      clearTimeout(focusTimer);
      if (!settings.focusSession) return;
      const delay = Math.max(0, Math.min(2_147_483_647, settings.focusSession.until - Date.now() + 50));
      focusTimer = setTimeout(() => void getSettings(), delay);
    }
    scheduleFocusExpiry();

    const shortsBlocked = () => settings.enabled && settings.blockShorts;
    // One stylesheet hides Shorts on every page, including ones FeedKeeper doesn't scan, as YouTube renders them.
    const shortsStyle = document.createElement('style');
    shortsStyle.textContent = `${SEL.shortsShelf}, ${SEL.shortsItem}, ${SEL.shortsNav} { display: none !important; }`;
    function applyShortsBlock(): void {
      if (shortsBlocked()) document.head.append(shortsStyle);
      else shortsStyle.remove();
    }
    applyShortsBlock();

    function scan(): void {
      updatePill();
      const page = currentPage();
      if (!settings.enabled || !page || !settings.surfaces[page]) return;

      for (const tile of pageTiles(page)) {
        const video = extractVideo(tile);
        if (!video) continue;
        // Shorts are never classified: Block Shorts hides them all for free, otherwise they're left as they are.
        if (video.isShort) continue;

        let state = tiles.get(tile);
        // YouTube recycles tile elements for different videos; start over when that happens.
        if (!state || state.video.videoId !== video.videoId) {
          state = { video, status: 'pending' };
          tiles.set(tile, state);
          removeDeco(tile);
          void classifyTile(tile, state);
        } else if (state.status === 'error' && Date.now() - (state.errorAt ?? 0) > RETRY_ERROR_AFTER_MS) {
          state.status = 'pending';
          void classifyTile(tile, state);
        } else if (state.decorated && !tile.querySelector('.ytf-node')) {
          // Our decoration was wiped by a YouTube re-render.
          render(tile, state);
        }
      }
    }

    async function classifyTile(tile: Element, state: TileState): Promise<void> {
      try {
        await classifyTileInner(tile, state);
      } catch (e) {
        // Anything unexpected must still surface in the pill instead of leaving the tile stuck.
        state.status = 'error';
        state.errorAt = Date.now();
        state.error = e instanceof Error ? e.message : String(e);
        console.warn(LOG, 'classify crashed', state.video.title, e);
      }
      updatePill();
    }

    async function classifyTileInner(tile: Element, state: TileState): Promise<void> {
      const { video } = state;
      const local = localDecision(video, settings);
      if (local) {
        state.status = 'scored';
        state.scores = {};
        state.localDecision = local;
        return render(tile, state);
      }

      let res = await requestScores(video);
      if (res.ok && 'needDetails' in res) {
        // Not cached yet: fetch the description etc. from YouTube, then ask again.
        video.details = await fetchDetails(video.videoId);
        if (tiles.get(tile) !== state) return;
        if (!video.channel && video.details?.author) video.channel = video.details.author;
        const detailedLocal = localDecision(video, settings);
        if (detailedLocal) {
          state.status = 'scored';
          state.scores = {};
          state.localDecision = detailedLocal;
          return render(tile, state);
        }
        res = await requestScores(video);
      }
      if (tiles.get(tile) !== state) return; // tile was recycled while we waited

      if (!res?.ok) {
        state.status = 'error';
        state.errorAt = Date.now();
        state.error = res?.error ?? 'No response from the extension background; reload the extension and this page';
        console.warn(LOG, 'classify failed', video.title, state.error);
        return;
      }
      if ('needDetails' in res) return; // unreachable: details were just attached
      if (!countedScans.has(video.videoId)) {
        countedScans.add(video.videoId);
        void browser.runtime.sendMessage({ type: 'countScanned' } satisfies Message);
      }
      state.status = 'scored';
      state.scores = res.scores;
      render(tile, state);
    }

    async function requestScores(video: VideoMeta, inspect = false, retried = false): Promise<ClassifyResponse> {
      try {
        return (await browser.runtime.sendMessage({ type: 'classify', video, inspect } satisfies Message)) as ClassifyResponse;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Chrome stopped the background worker mid-request; sending again starts a fresh one.
        if (!retried && /message channel closed/i.test(message)) return requestScores(video, inspect, true);
        // Happens when the extension is reloaded while this tab stays open.
        return { ok: false, error: `Extension unavailable (${message}); reload the page` };
      }
    }

    function matchesOf(state: TileState): { label: string; score: number }[] {
      if (!state.scores) return [];
      return settings.categories
        .filter((c) => c.enabled && state.scores![c.id] !== undefined)
        .map((c) => ({ label: c.label, score: state.scores![c.id]! }))
        .sort((a, b) => b.score - a.score);
    }

    function decisionOf(state: TileState): Decision {
      if (state.localDecision) return { ...state.localDecision, uncertain: false };
      const selected = settings.categories.filter((c) => c.enabled);
      if (selected.length === 0) {
        return settings.filterDirection === 'allow'
          ? { filter: true, uncertain: false, reason: 'No allowed categories selected' }
          : { filter: false, uncertain: false, reason: 'No blocked categories selected' };
      }
      // Fitting "at least one selected category" is never less likely than fitting one of them, so the
      // combined answer only adds matches split across overlapping categories; it can't veto a clear one.
      const score = Math.max(state.scores?.[SELECTION_SCORE_ID] ?? 0, ...selected.map((c) => state.scores?.[c.id] ?? 0));
      const matched = score >= settings.threshold;
      const uncertain = !matched && score >= Math.max(0, settings.threshold - settings.uncertainMargin);
      // Borderline videos follow the same setting in both directions: shown, dimmed (still shown) or hidden.
      const hideBorderline = uncertain && settings.uncertainBehavior === 'hide';
      if (settings.filterDirection === 'allow') {
        return {
          filter: !matched && (!uncertain || hideBorderline),
          uncertain,
          score,
          reason: matched ? 'Matches your allowed categories' : uncertain ? 'Uncertain allowed-category match' : 'Outside your allowed categories',
        };
      }
      return {
        filter: matched || hideBorderline,
        uncertain,
        score,
        reason: matched ? 'Matches blocked categories' : uncertain ? 'Uncertain category match' : 'Below the filter threshold',
      };
    }

    /**
     * Only confident block matches are sent to YouTube as "Not interested"; that feedback is hard to undo.
     * Borderline videos set to Hide and everything in allow-only mode are hidden locally instead.
     */
    function autoRemovable(decision: Decision): boolean {
      return (
        settings.mode === 'auto' &&
        settings.filterDirection === 'block' &&
        decision.filter &&
        !decision.uncertain &&
        !rescoreTimer // never act on scores for a category selection the user just changed
      );
    }

    function inspectButton(tile: Element, state: TileState): HTMLButtonElement {
      const button = document.createElement('button');
      button.className = 'ytf-inspect';
      button.textContent = state.inspectorOpen ? 'Close details' : 'Why?';
      button.title = 'Inspect this video’s category distribution';
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.inspectorOpen = !state.inspectorOpen;
        render(tile, state);
        if (state.inspectorOpen && !state.inspectionScores && !state.inspectorLoading) void inspectVideo(tile, state);
      });
      return button;
    }

    async function inspectVideo(tile: Element, state: TileState): Promise<void> {
      state.inspectorLoading = true;
      state.inspectorError = undefined;
      render(tile, state);
      let res = await requestScores(state.video, true);
      if (res.ok && 'needDetails' in res) {
        state.video.details = await fetchDetails(state.video.videoId);
        if (tiles.get(tile) !== state) return;
        res = await requestScores(state.video, true);
      }
      if (tiles.get(tile) !== state) return;
      state.inspectorLoading = false;
      if (!res.ok || 'needDetails' in res) state.inspectorError = !res.ok ? res.error : 'Could not load video details';
      else {
        state.inspectionScores = res.scores;
        state.scores = { ...state.scores, ...res.scores };
      }
      render(tile, state);
    }

    function inspector(tile: Element, state: TileState, decision: Decision): HTMLElement {
      const panel = document.createElement('div');
      panel.className = 'ytf-inspector';
      panel.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      const title = document.createElement('strong');
      title.textContent = decision.filter ? 'Filtered' : decision.uncertain ? 'Uncertain' : 'Shown';
      const detail = document.createElement('span');
      detail.className = 'ytf-inspector-reason';
      detail.textContent = `${decision.reason}${decision.score === undefined ? '' : ` · ${pct(decision.score)}`} · threshold ${pct(settings.threshold)}`;
      panel.append(title, detail);
      if (state.inspectorLoading) panel.append(chip('Loading full category distribution…', 'ytf-inspector-status'));
      else if (state.inspectorError) panel.append(chip(state.inspectorError, 'ytf-inspector-error'));
      else if (state.inspectionScores) {
        const rows = settings.categories
          .filter((c) => state.inspectionScores?.[c.id] !== undefined)
          .map((c) => ({ c, score: state.inspectionScores![c.id]! }))
          .sort((a, b) => b.score - a.score);
        const shown = state.inspectorShowAll ? rows : rows.slice(0, 5);
        const list = document.createElement('div');
        list.className = 'ytf-inspector-scores';
        for (const { c, score } of shown) {
          const row = document.createElement('div');
          row.className = c.enabled ? 'ytf-inspector-selected' : '';
          row.append(chip(c.label, ''), chip(pct(score), ''));
          list.append(row);
        }
        panel.append(list);
        if (rows.length > 5) {
          const more = document.createElement('button');
          more.textContent = state.inspectorShowAll ? 'Show top 5' : `Show all ${rows.length}`;
          more.addEventListener('click', () => {
            state.inspectorShowAll = !state.inspectorShowAll;
            render(tile, state);
          });
          panel.append(more);
        }
      }
      const actions = document.createElement('div');
      actions.className = 'ytf-inspector-actions';
      // Remembered with the filter they were judged under, so they can be exported as test cases (Settings).
      const correct = (want: 'show' | 'hide') => {
        if (!settings.historyEnabled || state.localDecision) return;
        void recordCorrection({
          videoId: state.video.videoId,
          title: state.video.title,
          channel: state.video.channel,
          duration: state.video.duration,
          at: Date.now(),
          want,
          wasFiltered: decision.filter,
          reason: decision.reason,
          score: decision.score,
          filterDirection: settings.filterDirection,
          matchMethod: settings.matchMethod,
          threshold: settings.threshold,
          categories: settings.categories
            .filter((c) => c.enabled)
            .map(({ id, label, description, builtin, customized }) => ({ id, label, description, builtin, customized })),
        });
      };
      actions.append(
        feedbackButton('Always show video', async () => {
          correct('show');
          await saveSettings({
            alwaysShowVideos: unique([...settings.alwaysShowVideos, state.video.videoId]),
            alwaysHideVideos: settings.alwaysHideVideos.filter((id) => id !== state.video.videoId),
          });
        }),
        feedbackButton('Always hide video', async () => {
          correct('hide');
          await saveSettings({
            alwaysHideVideos: unique([...settings.alwaysHideVideos, state.video.videoId]),
            alwaysShowVideos: settings.alwaysShowVideos.filter((id) => id !== state.video.videoId),
          });
        }),
      );
      if (state.video.channel) {
        actions.append(
          feedbackButton('Allow channel', async () => {
            const channel = state.video.channel.toLowerCase();
            await saveSettings({ allowlist: unique([...settings.allowlist, channel]), blocklist: settings.blocklist.filter((x) => x !== channel) });
          }),
          feedbackButton('Block channel', async () => {
            const channel = state.video.channel.toLowerCase();
            await saveSettings({ blocklist: unique([...settings.blocklist, channel]), allowlist: settings.allowlist.filter((x) => x !== channel) });
          }),
        );
      }
      actions.append(feedbackButton('Edit category definitions', () => browser.runtime.openOptionsPage()));
      panel.append(actions);
      return panel;
    }

    function render(tile: Element, state: TileState): void {
      removeDeco(tile);
      state.decorated = false;
      const page = currentPage();
      if (!settings.enabled || !page || !settings.surfaces[page]) return;

      const matches = matchesOf(state);
      const decision = decisionOf(state);
      const deco = document.createElement('div');
      deco.className = 'ytf-node ytf-deco';
      const scoreSummary = decision.score === undefined ? '' : ` ${pct(decision.score)}`;
      const categorySummary = matches.slice(0, 2).map((m) => m.label).join(' + ');
      const summary = `${decision.reason}${scoreSummary}${categorySummary ? ` · ${categorySummary}` : ''}`;

      if (decision.filter && !countedMatches.has(state.video.videoId)) {
        countedMatches.add(state.video.videoId);
        void browser.runtime.sendMessage({ type: 'countMatch' } satisfies Message);
      }
      if (decision.filter && settings.historyEnabled && !recordedDecisions.has(state.video.videoId)) {
        recordedDecisions.add(state.video.videoId);
        void recordDecision({
          videoId: state.video.videoId,
          title: state.video.title,
          channel: state.video.channel,
          at: Date.now(),
          action: settings.mode === 'preview' ? 'would-filter' : 'hidden',
          reason: decision.reason,
          score: decision.score,
        });
      }

      tile.classList.add('ytf-tile');
      if (state.inspectorOpen) tile.classList.add('ytf-inspector-open');
      deco.append(inspectButton(tile, state));
      if (state.inspectorOpen) deco.append(inspector(tile, state, decision));

      if (settings.mode === 'preview') {
        if (decision.filter) {
          tile.classList.add('ytf-match');
          deco.append(badge('ytf-badge ytf-hit', `Would filter · ${summary}`));
        } else if (decision.uncertain && settings.uncertainBehavior === 'dim') {
          tile.classList.add('ytf-uncertain');
          deco.append(badge('ytf-badge ytf-warn', `Uncertain · ${scoreSummary.trim()}`));
        }
        tile.append(deco);
        state.decorated = true;
        return;
      }

      if (!decision.filter) {
        if (decision.uncertain && settings.uncertainBehavior === 'dim') tile.classList.add('ytf-uncertain');
        tile.append(deco);
        state.decorated = true;
        return;
      }

      // hide / auto
      if (!state.revealed) tile.classList.add('ytf-hidden');
      deco.classList.add('ytf-cover');
      const label = document.createElement('div');
      label.className = 'ytf-cover-label';
      label.textContent = autoRemovable(decision) ? `Removing · ${summary}` : `Hidden · ${summary}`;
      const show = document.createElement('button');
      show.className = 'ytf-show';
      show.textContent = state.revealed ? 'Hide' : 'Show';
      show.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.revealed = !state.revealed;
        render(tile, state);
      });
      label.append(show);
      deco.append(label);
      tile.append(deco);
      state.decorated = true;

      if (autoRemovable(decision) && !state.queued) {
        state.queued = true;
        const { videoId } = state.video;
        queue.push(videoId, async () => {
          const pageNow = currentPage();
          if (!settings.enabled || !pageNow || !settings.surfaces[pageNow]) return 'skip';
          if (!tile.isConnected || tiles.get(tile)?.video.videoId !== videoId) return 'skip';
          if (!autoRemovable(decisionOf(state))) return 'skip';
          const result = await clickNotInterested(tile);
          if (result === 'menu-busy') return 'retry';
          if (result === 'done') {
            // Uncover the tile so YouTube's own "Undo" link is reachable.
            removeDeco(tile);
            state.decorated = false;
            void browser.runtime.sendMessage({ type: 'countActioned' } satisfies Message);
            if (settings.historyEnabled) {
              void recordDecision({
                videoId: state.video.videoId,
                title: state.video.title,
                channel: state.video.channel,
                at: Date.now(),
                action: 'removed',
                reason: decision.reason,
                score: decision.score,
              });
            }
            console.info(LOG, 'Not interested:', state.video.title, `(${summary})`);
          } else {
            console.warn(LOG, `Could not click "Not interested" (${result}):`, state.video.title);
            if (result === 'no-button' || result === 'no-menu' || result === 'no-item') return 'skip';
          }
        });
      }
    }

    let pillTimer: ReturnType<typeof setTimeout> | undefined;
    function updatePill(): void {
      if (pillTimer) return;
      pillTimer = setTimeout(() => {
        pillTimer = undefined;
        const page = currentPage();
        if (!settings.enabled || !page || !settings.surfaces[page]) return pill.hide();

        let scored = 0;
        let pending = 0;
        let matched = 0;
        let failed = 0;
        let lastError = '';
        for (const tile of pageTiles(page)) {
          const st = tiles.get(tile);
          if (!st) continue;
          if (st.status === 'pending') pending++;
          else if (st.status === 'error') {
            failed++;
            lastError = st.error ?? lastError;
          } else {
            scored++;
            if (decisionOf(st).filter) matched++;
          }
        }

        if (!settings.apiKey) return pill.show('Add your OpenRouter API key in the FeedKeeper popup to start.', 'error');
        const verb = settings.mode === 'preview' ? 'would filter' : settings.mode === 'hide' || settings.filterDirection === 'allow' ? 'hidden' : 'removed';
        const parts = [`${scored} scored`, `${matched} ${verb}`];
        if (pending) parts.push(`${pending} scoring…`);
        if (failed) {
          parts.push(`${failed} failed`);
          pill.show(`${parts.join(' · ')}\n${friendlyError(lastError)}`, 'error');
        } else {
          pill.show(parts.join(' · '), 'ok');
        }
      }, 250);
    }

    function rerenderAll(): void {
      for (const tile of document.querySelectorAll(ALL_TILES)) {
        const state = tiles.get(tile);
        if (state?.status === 'scored') render(tile, state);
        else removeDeco(tile);
      }
    }

    onSettingsChanged((next) => {
      const prev = settings;
      settings = next;
      scheduleFocusExpiry();
      applyShortsBlock();
      const queuePolicyChanged =
        !next.enabled ||
        next.mode !== 'auto' ||
        prev.mode !== next.mode ||
        prev.blockShorts !== next.blockShorts ||
        prev.filterDirection !== next.filterDirection ||
        prev.threshold !== next.threshold ||
        prev.uncertainBehavior !== next.uncertainBehavior ||
        prev.uncertainMargin !== next.uncertainMargin ||
        JSON.stringify(prev.surfaces) !== JSON.stringify(next.surfaces);
      if (queuePolicyChanged) {
        queue.clear();
        for (const tile of document.querySelectorAll(ALL_TILES)) {
          const state = tiles.get(tile);
          if (state) state.queued = false;
        }
      }

      const ids = (x: Settings) => categoriesToScore(x).map((c) => c.id).join();
      const catsChanged =
        JSON.stringify(prev.categories) !== JSON.stringify(next.categories) || ids(prev) !== ids(next) || prev.matchMethod !== next.matchMethod;
      const localRulesChanged =
        prev.allowlist.join('\n') !== next.allowlist.join('\n') ||
        prev.blocklist.join('\n') !== next.blocklist.join('\n') ||
        prev.allowedKeywords.join('\n') !== next.allowedKeywords.join('\n') ||
        prev.blockedKeywords.join('\n') !== next.blockedKeywords.join('\n') ||
        prev.alwaysShowVideos.join('\n') !== next.alwaysShowVideos.join('\n') ||
        prev.alwaysHideVideos.join('\n') !== next.alwaysHideVideos.join('\n');
      const keyAdded = !prev.apiKey && !!next.apiKey;
      if (localRulesChanged || keyAdded || (next.enabled && !prev.enabled)) {
        rescoreAll();
      } else if (catsChanged) {
        // Every selection change alters the combined question, so each one would re-ask Jev about every
        // tile. Wait until the user stops toggling categories and pay only for the final selection.
        queue.clear();
        clearTimeout(rescoreTimer);
        rescoreTimer = setTimeout(rescoreAll, RESCORE_DELAY_MS);
      } else if (!rescoreTimer) {
        rerenderAll();
      }
      updatePill();
    });

    function rescoreAll(): void {
      clearTimeout(rescoreTimer);
      rescoreTimer = undefined;
      queue.clear();
      // Re-ask: the background cache answers already-known categories without an API call.
      for (const tile of document.querySelectorAll(ALL_TILES)) {
        tiles.delete(tile);
        removeDeco(tile);
      }
      scan();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleScan = () => {
      clearTimeout(timer);
      timer = setTimeout(scan, 300);
    };
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', () => {
      // Queued removals belong to the page they were found on; re-queue this page's matches,
      // since YouTube keeps the home grid alive while you're on a video.
      queue.clear();
      const page = currentPage();
      for (const tile of page ? pageTiles(page) : []) {
        const state = tiles.get(tile);
        if (state?.queued && extractVideo(tile)?.videoId === state.video.videoId) {
          state.queued = false;
          render(tile, state);
        }
      }
      scheduleScan();
    });
    scan();
  },
});

function removeDeco(tile: Element): void {
  for (const n of tile.querySelectorAll('.ytf-node')) n.remove();
  tile.classList.remove('ytf-tile', 'ytf-match', 'ytf-hidden', 'ytf-uncertain', 'ytf-inspector-open');
}

function chip(text: string, className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function badge(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

interface Decision {
  filter: boolean;
  uncertain: boolean;
  reason: string;
  score?: number;
}

function localDecision(video: VideoMeta, settings: Settings): { filter: boolean; reason: string } | undefined {
  const channel = video.channel.toLowerCase();
  const title = video.title.toLowerCase();
  if (settings.alwaysShowVideos.includes(video.videoId)) return { filter: false, reason: 'Always show video' };
  if (settings.alwaysHideVideos.includes(video.videoId)) return { filter: true, reason: 'Always hide video' };
  if (channel && settings.allowlist.includes(channel)) return { filter: false, reason: 'Allowed channel' };
  if (channel && settings.blocklist.includes(channel)) return { filter: true, reason: 'Blocked channel' };
  const allowed = settings.allowedKeywords.find((phrase) => hasPhrase(title, phrase));
  if (allowed) return { filter: false, reason: `Allowed title rule: ${allowed}` };
  const blocked = settings.blockedKeywords.find((phrase) => hasPhrase(title, phrase));
  if (blocked) return { filter: true, reason: `Blocked title rule: ${blocked}` };
  return undefined;
}

/** Whole-word, case-insensitive match, so a rule for "ai" doesn't catch "rain" or "said". */
function hasPhrase(title: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'u').test(title);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function feedbackButton(label: string, action: () => Promise<unknown>): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', () => void action());
  return button;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function friendlyError(e: string): string {
  if (/\b401\b|No auth|invalid.*key/i.test(e)) return `API key rejected: ${e}`;
  if (/\b402\b|credit/i.test(e)) return `OpenRouter credits: ${e}`;
  if (/\b404\b|model/i.test(e)) return `Model problem (check the Jev model name in Settings): ${e}`;
  return e;
}

/** Small fixed badge showing progress, and the actual error text when classification fails. */
class StatusPill {
  private el?: HTMLElement;
  private text?: HTMLElement;
  private dismissed = false;

  show(message: string, tone: 'ok' | 'error'): void {
    if (this.dismissed) return;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'ytf-pill';
      const title = document.createElement('b');
      title.textContent = 'FeedKeeper';
      this.text = document.createElement('span');
      const close = document.createElement('button');
      close.textContent = '×';
      close.title = 'Hide until the page reloads';
      close.addEventListener('click', () => {
        this.dismissed = true;
        this.hide();
      });
      this.el.append(title, this.text, close);
    }
    if (!this.el.isConnected) document.body.append(this.el);
    this.el.classList.toggle('ytf-pill-error', tone === 'error');
    this.text!.textContent = message;
  }

  hide(): void {
    this.el?.remove();
  }
}
