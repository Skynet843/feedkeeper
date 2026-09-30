import { browser } from 'wxt/browser';
import '@/lib/ui.css';
import { groupCategories, newCustomCategory } from '@/lib/categories';
import { cachedDetails } from '@/lib/classifier';
import { applyProfile, clearCorrections, clearDecisionHistory, getCorrections, getDecisionHistory, getSettings, saveSettings } from '@/lib/storage';
import type { Category, FilterProfile, Message, Settings, TestKeyResponse } from '@/lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);

let savedTimer: ReturnType<typeof setTimeout> | undefined;
async function save(patch: Partial<Settings>): Promise<Settings> {
  const s = await saveSettings(patch);
  $('saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1200);
  return s;
}

function renderCategories(cats: Category[]): void {
  $('cats').replaceChildren(
    ...groupCategories(cats).flatMap(([group, list]) => {
      const title = document.createElement('h3');
      title.className = 'group-title';
      title.textContent = group;
      return [title, ...list.map(categoryRow)];
    }),
  );
}

function categoryRow(c: Category): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cat';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = c.enabled;
  check.addEventListener('change', () => updateCategory(c.id, { enabled: check.checked }));

  const name = document.createElement('strong');
  name.textContent = c.label;

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.hidden = c.builtin;
  remove.addEventListener('click', async () => {
    const s = await getSettings();
    renderCategories((await save({ categories: s.categories.filter((x) => x.id !== c.id) })).categories);
  });

  const desc = document.createElement('textarea');
  desc.className = 'desc';
  desc.value = c.description;
  desc.rows = 2;
  desc.style.minHeight = '0';
  desc.addEventListener('change', () =>
    updateCategory(c.id, { description: desc.value.trim() || c.description, customized: true }),
  );

  row.append(check, name, remove, desc);
  return row;
}

async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  const s = await getSettings();
  await save({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

const lines = (value: string) => [...new Set(value.split('\n').map((x) => x.trim().toLowerCase()).filter(Boolean))];

function renderProfiles(profiles: FilterProfile[]): void {
  $('profiles').replaceChildren(
    ...profiles.map((profile) => {
      const row = document.createElement('div');
      row.className = 'profile';
      const text = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = profile.name;
      const detail = document.createElement('div');
      detail.className = 'muted';
      detail.textContent = `${profile.filterDirection === 'block' ? 'Block selected' : 'Only show selected'} · ${Math.round(profile.threshold * 100)}% · ${profile.categoryIds.length} categories`;
      text.append(name, detail);
      const apply = document.createElement('button');
      apply.textContent = 'Apply';
      apply.addEventListener('click', async () => {
        await applyProfile(profile);
        location.reload();
      });
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        const current = await getSettings();
        renderProfiles((await save({ profiles: current.profiles.filter((p) => p.id !== profile.id) })).profiles);
      });
      row.append(text, apply, remove);
      return row;
    }),
  );
}

async function renderHistory(): Promise<void> {
  const history = await getDecisionHistory();
  $('history').replaceChildren(
    ...history.slice(0, 50).map((entry) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const text = document.createElement('div');
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = entry.title || entry.videoId;
      const detail = document.createElement('div');
      detail.className = 'muted';
      detail.textContent = `${new Date(entry.at).toLocaleString()} · ${entry.action.replace('-', ' ')} · ${entry.reason}${entry.score === undefined ? '' : ` (${Math.round(entry.score * 100)}%)`}`;
      text.append(link, detail);
      const show = document.createElement('button');
      show.textContent = 'Always show';
      show.title = 'Correct future FeedKeeper decisions for this video';
      show.addEventListener('click', async () => {
        const current = await getSettings();
        await save({
          alwaysShowVideos: [...new Set([...current.alwaysShowVideos, entry.videoId])],
          alwaysHideVideos: current.alwaysHideVideos.filter((id) => id !== entry.videoId),
        });
      });
      row.append(text, show);
      if (entry.channel) {
        const allow = document.createElement('button');
        allow.textContent = 'Allow channel';
        allow.addEventListener('click', async () => {
          const current = await getSettings();
          const channel = entry.channel.toLowerCase();
          await save({
            allowlist: [...new Set([...current.allowlist, channel])],
            blocklist: current.blocklist.filter((x) => x !== channel),
          });
        });
        row.append(allow);
      }
      return row;
    }),
  );
  if (!history.length) $('history').textContent = 'No filtered videos recorded yet.';
}

async function renderCorrections(): Promise<void> {
  const list = await getCorrections();
  const wrong = list.filter((c) => c.wasFiltered !== (c.want === 'hide')).length;
  $('corrections-count').textContent = `${list.length} saved, ${wrong} where FeedKeeper got it wrong`;
  $<HTMLButtonElement>('exportCorrections').disabled = list.length === 0;
}

async function exportCorrections(): Promise<void> {
  const list = await getCorrections();
  // Cached details let the eval replay the exact request without fetching YouTube again.
  const corrections = await Promise.all(list.map(async (c) => ({ ...c, details: await cachedDetails(c.videoId) })));
  const file = { format: 'feedkeeper-corrections', version: 1, exportedAt: new Date().toISOString(), corrections };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedkeeper-corrections-${file.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init(): Promise<void> {
  const s = await getSettings();

  input('apiKey').value = s.apiKey;
  input('model').value = s.model;
  $<HTMLTextAreaElement>('allowlist').value = s.allowlist.join('\n');
  $<HTMLTextAreaElement>('blocklist').value = s.blocklist.join('\n');
  $<HTMLTextAreaElement>('allowedKeywords').value = s.allowedKeywords.join('\n');
  $<HTMLTextAreaElement>('blockedKeywords').value = s.blockedKeywords.join('\n');
  $<HTMLSelectElement>('filterDirection').value = s.filterDirection;
  $<HTMLSelectElement>('matchMethod').value = s.matchMethod;
  $<HTMLSelectElement>('uncertainBehavior').value = s.uncertainBehavior;
  $<HTMLSelectElement>('uncertainMargin').value = String(s.uncertainMargin);
  input('surfaceHome').checked = s.surfaces.home;
  input('surfaceWatch').checked = s.surfaces.watch;
  input('blockShorts').checked = s.blockShorts;
  input('historyEnabled').checked = s.historyEnabled;
  input('useDescription').checked = s.useDescription;
  input('minDelay').value = String(s.pacing.minDelayMs / 1000);
  input('maxDelay').value = String(s.pacing.maxDelayMs / 1000);
  input('perMinute').value = String(s.pacing.maxPerMinute);
  input('perSession').value = String(s.pacing.maxPerSession);
  renderCategories(s.categories);
  renderProfiles(s.profiles);
  void renderHistory();
  void renderCorrections();

  input('apiKey').addEventListener('change', () => save({ apiKey: input('apiKey').value.trim() }));
  input('model').addEventListener('change', () => save({ model: input('model').value.trim() || 'jev-1.13' }));
  input('useDescription').addEventListener('change', () => save({ useDescription: input('useDescription').checked }));
  $<HTMLSelectElement>('filterDirection').addEventListener('change', async () => {
    const filterDirection = $<HTMLSelectElement>('filterDirection').value as Settings['filterDirection'];
    const current = await getSettings();
    await save({ filterDirection, ...(filterDirection === 'allow' && current.mode === 'auto' ? { mode: 'hide' as const } : {}) });
  });
  $<HTMLSelectElement>('matchMethod').addEventListener('change', () =>
    save({ matchMethod: $<HTMLSelectElement>('matchMethod').value as Settings['matchMethod'] }),
  );
  $<HTMLSelectElement>('uncertainBehavior').addEventListener('change', () =>
    save({ uncertainBehavior: $<HTMLSelectElement>('uncertainBehavior').value as Settings['uncertainBehavior'] }),
  );
  $<HTMLSelectElement>('uncertainMargin').addEventListener('change', () =>
    save({ uncertainMargin: Number($<HTMLSelectElement>('uncertainMargin').value) }),
  );
  input('surfaceHome').addEventListener('change', async () => {
    const current = await getSettings();
    await save({ surfaces: { ...current.surfaces, home: input('surfaceHome').checked } });
  });
  input('surfaceWatch').addEventListener('change', async () => {
    const current = await getSettings();
    await save({ surfaces: { ...current.surfaces, watch: input('surfaceWatch').checked } });
  });
  input('blockShorts').addEventListener('change', () => save({ blockShorts: input('blockShorts').checked }));
  input('historyEnabled').addEventListener('change', () => save({ historyEnabled: input('historyEnabled').checked }));
  $('allowlist').addEventListener('change', () =>
    save({ allowlist: lines($<HTMLTextAreaElement>('allowlist').value) }),
  );
  $('blocklist').addEventListener('change', () => save({ blocklist: lines($<HTMLTextAreaElement>('blocklist').value) }));
  $('allowedKeywords').addEventListener('change', () => save({ allowedKeywords: lines($<HTMLTextAreaElement>('allowedKeywords').value) }));
  $('blockedKeywords').addEventListener('change', () => save({ blockedKeywords: lines($<HTMLTextAreaElement>('blockedKeywords').value) }));

  for (const id of ['minDelay', 'maxDelay', 'perMinute', 'perSession']) {
    input(id).addEventListener('change', async () => {
      const min = Math.max(0.5, Number(input('minDelay').value) || 1.5);
      const max = Math.max(min, Number(input('maxDelay').value) || 4);
      await save({
        pacing: {
          minDelayMs: min * 1000,
          maxDelayMs: max * 1000,
          maxPerMinute: Math.max(1, Math.round(Number(input('perMinute').value) || 20)),
          maxPerSession: Math.max(1, Math.round(Number(input('perSession').value) || 100)),
        },
      });
    });
  }

  $('test').addEventListener('click', async () => {
    const out = $('test-result');
    const btn = $<HTMLButtonElement>('test');
    btn.disabled = true;
    out.className = 'muted';
    out.textContent = 'Testing…';
    const apiKey = input('apiKey').value.trim();
    await save({ apiKey });
    const res = (await browser.runtime.sendMessage({
      type: 'testKey',
      apiKey,
      model: input('model').value.trim() || 'jev-1.13',
    } satisfies Message)) as TestKeyResponse;
    btn.disabled = false;
    if (res.ok) {
      out.className = 'ok';
      out.textContent = `Works. ${res.model} says a "Try Not To Laugh" compilation is comedy with ${Math.round(res.noul * 100)}% probability.`;
    } else {
      out.className = 'err';
      out.textContent = res.error;
    }
  });

  $('add-cat').addEventListener('click', async () => {
    const label = input('new-label').value.trim();
    const description = $<HTMLTextAreaElement>('new-desc').value.trim();
    if (!label || !description) return;
    const cur = await getSettings();
    const next = await save({ categories: [...cur.categories, newCustomCategory(label, description)] });
    input('new-label').value = '';
    $<HTMLTextAreaElement>('new-desc').value = '';
    renderCategories(next.categories);
  });

  $('saveProfile').addEventListener('click', async () => {
    const name = input('profileName').value.trim();
    if (!name) return;
    const current = await getSettings();
    const profile: FilterProfile = {
      id: `profile_${Date.now().toString(36)}`,
      name,
      filterDirection: current.filterDirection,
      threshold: current.threshold,
      categoryIds: current.categories.filter((c) => c.enabled).map((c) => c.id),
    };
    const profiles = [...current.profiles.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), profile];
    renderProfiles((await save({ profiles })).profiles);
    input('profileName').value = '';
  });

  $('refreshHistory').addEventListener('click', () => {
    void renderHistory();
    void renderCorrections();
  });
  $('exportCorrections').addEventListener('click', () => void exportCorrections());
  $('clearCorrections').addEventListener('click', async () => {
    await clearCorrections();
    await renderCorrections();
  });
  $('clearHistory').addEventListener('click', async () => {
    await clearDecisionHistory();
    await renderHistory();
  });

  $('clear-cache').addEventListener('click', async () => {
    const res = (await browser.runtime.sendMessage({ type: 'clearCache' } satisfies Message)) as { removed: number };
    $('cache-result').textContent = `Removed ${res.removed} cached videos.`;
  });
}

void init();
