import { browser } from 'wxt/browser';
import '@/lib/ui.css';
import { CUSTOM_GROUP, groupCategories, newCustomCategory } from '@/lib/categories';
import { applyProfile, getSettings, getTodayStats, saveSettings, stopFocusSession } from '@/lib/storage';
import type { FilterDirection, Message, Mode, Settings, TestKeyResponse } from '@/lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODE_HELP: Record<Mode, string> = {
  preview: 'Outlines videos that would be removed. Nothing is hidden or clicked.',
  hide: 'Blurs matches in your feed. Nothing is sent to YouTube.',
  auto: 'Blurs matches and clicks "Not interested" on them, a few seconds apart.',
};

const DIRECTION_HELP: Record<FilterDirection, string> = {
  block: 'Selected categories are filtered. Everything else stays visible.',
  allow: 'Only selected categories stay visible. Other videos are hidden, never auto-removed.',
};

let editingKey = false;

// Which category groups are expanded; a per-browser convenience, so localStorage is enough.
const OPEN_GROUPS_KEY = 'ytf-open-groups';
const openGroups = new Set<string>(readOpenGroups());
function readOpenGroups(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveOpenGroups(): void {
  try {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...openGroups]));
  } catch {}
}

async function render(s: Settings): Promise<void> {
  $<HTMLInputElement>('enabled').checked = s.enabled;
  $<HTMLInputElement>('blockShorts').checked = s.blockShorts;

  const showEdit = !s.apiKey || editingKey;
  $('key-edit').hidden = !showEdit;
  $('key-view').hidden = showEdit;
  $('key-masked').textContent = maskKey(s.apiKey);

  for (const b of $('mode').querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode));
  }
  $('mode-help').textContent = MODE_HELP[s.mode];
  for (const b of $('direction').querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.direction === s.filterDirection));
  }
  $('direction-help').textContent = DIRECTION_HELP[s.filterDirection];
  $('categories-heading').textContent = s.filterDirection === 'block' ? 'Block these' : 'Only show these';
  const auto = $('mode').querySelector<HTMLButtonElement>('[data-mode="auto"]');
  if (auto) {
    auto.disabled = s.filterDirection === 'allow';
    auto.title = s.filterDirection === 'allow' ? 'Allow-only mode hides unmatched videos without sending feedback to YouTube' : '';
  }
  $<HTMLInputElement>('combinedMatch').checked = s.matchMethod === 'combined';

  const selected = s.categories.filter((c) => c.enabled).map((c) => c.label);
  $('selected-summary').textContent = selected.length
    ? `${s.filterDirection === 'block' ? 'Blocked' : 'Allowed'}: ${selected.join(', ')}`
    : 'Nothing selected yet. Open a group and click a category.';

  $('cats').replaceChildren(
    ...groupCategories(s.categories).map(([group, cats]) => {
      const box = document.createElement('details');
      box.className = 'group';
      box.open = openGroups.has(group);
      box.addEventListener('toggle', () => {
        if (box.open) openGroups.add(group);
        else openGroups.delete(group);
        saveOpenGroups();
      });

      const summary = document.createElement('summary');
      const name = document.createElement('span');
      name.className = 'group-name';
      name.textContent = group;
      const n = cats.filter((c) => c.enabled).length;
      const count = document.createElement('span');
      count.className = n ? 'group-count has' : 'group-count';
      count.textContent = n ? `${n} of ${cats.length} selected` : `${cats.length}`;
      summary.append(name, count);

      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(
        ...cats.map((c) => {
          const b = document.createElement('button');
          b.className = 'chip';
          b.textContent = c.label;
          b.title = c.description;
          b.setAttribute('aria-pressed', String(c.enabled));
          b.addEventListener('click', async () => {
            const cur = await getSettings();
            void render(
              await saveSettings({
                categories: cur.categories.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)),
              }),
            );
          });
          return b;
        }),
      );
      box.append(summary, chips);
      return box;
    }),
  );

  $<HTMLInputElement>('threshold').value = String(s.threshold);
  $('threshold-value').textContent = `${Math.round(s.threshold * 100)}%`;
  $('threshold-help').textContent = s.filterDirection === 'allow'
    ? 'A video must match the selected categories with at least this confidence to stay visible.'
    : 'A video is filtered when the selected-category confidence reaches this level.';

  const focusActive = !!s.focusSession && s.focusSession.until > Date.now();
  $('focus-active').hidden = !focusActive;
  $('focus-start').hidden = focusActive;
  if (focusActive) {
    const minutes = Math.max(1, Math.ceil((s.focusSession!.until - Date.now()) / 60_000));
    $('focus-status').textContent = `${s.focusSession!.profileName} active · ${minutes} min remaining`;
  } else {
    const select = $<HTMLSelectElement>('focus-profile');
    select.replaceChildren(...s.profiles.map((p) => new Option(p.name, p.id)));
    $<HTMLButtonElement>('focus-go').disabled = s.profiles.length === 0;
    $('focus-help').textContent = s.profiles.length
      ? 'The previous filter is restored automatically when time expires.'
      : 'Create a profile in Settings, then apply it temporarily here.';
  }

  const st = await getTodayStats();
  $('s-scanned').textContent = String(st.scanned);
  $('s-matched').textContent = String(st.matched);
  $('s-actioned').textContent = String(st.actioned);
  $('s-cost').textContent = st.costUsd < 0.01 ? `$${st.costUsd.toFixed(4)}` : `$${st.costUsd.toFixed(2)}`;
}

$<HTMLInputElement>('enabled').addEventListener('change', async (e) => {
  await saveSettings({ enabled: (e.target as HTMLInputElement).checked });
});

$<HTMLInputElement>('blockShorts').addEventListener('change', async (e) => {
  await saveSettings({ blockShorts: (e.target as HTMLInputElement).checked });
});

$('mode').addEventListener('click', async (e) => {
  const mode = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.mode as Mode | undefined;
  if (!mode) return;
  void render(await saveSettings({ mode }));
});

$('direction').addEventListener('click', async (e) => {
  const filterDirection = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.direction as FilterDirection | undefined;
  if (!filterDirection) return;
  const cur = await getSettings();
  void render(await saveSettings({ filterDirection, ...(filterDirection === 'allow' && cur.mode === 'auto' ? { mode: 'hide' as const } : {}) }));
});

$<HTMLInputElement>('combinedMatch').addEventListener('change', async (e) => {
  await saveSettings({ matchMethod: (e.target as HTMLInputElement).checked ? 'combined' : 'individual' });
});

$('focus-go').addEventListener('click', async () => {
  const cur = await getSettings();
  const profile = cur.profiles.find((p) => p.id === $<HTMLSelectElement>('focus-profile').value);
  if (!profile) return;
  void render(await applyProfile(profile, Number($<HTMLSelectElement>('focus-minutes').value)));
});

$('focus-stop').addEventListener('click', async () => void render(await stopFocusSession()));

const customForm = $<HTMLFormElement>('custom-form');
function toggleCustomForm(open: boolean): void {
  customForm.hidden = !open;
  $('custom-open').hidden = open;
  $('custom-error').textContent = '';
  if (open) $<HTMLInputElement>('custom-label').focus();
}
$('custom-open').addEventListener('click', () => toggleCustomForm(true));
$('custom-cancel').addEventListener('click', () => toggleCustomForm(false));
customForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = $<HTMLInputElement>('custom-label').value.trim();
  const description = $<HTMLTextAreaElement>('custom-desc').value.trim();
  const cur = await getSettings();
  if (cur.categories.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
    $('custom-error').textContent = `"${label}" already exists.`;
    return;
  }
  const next = await saveSettings({ categories: [...cur.categories, newCustomCategory(label, description)] });
  customForm.reset();
  toggleCustomForm(false);
  openGroups.add(CUSTOM_GROUP);
  saveOpenGroups();
  void render(next);
});

const threshold = $<HTMLInputElement>('threshold');
threshold.addEventListener('input', () => {
  $('threshold-value').textContent = `${Math.round(Number(threshold.value) * 100)}%`;
});
threshold.addEventListener('change', async () => {
  await saveSettings({ threshold: Number(threshold.value) });
});

function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : '••••';
}

function keyStatus(text: string, tone: 'muted' | 'ok' | 'err'): void {
  const el = $('key-status');
  el.hidden = false;
  el.textContent = text;
  el.style.color = tone === 'ok' ? 'var(--ok)' : tone === 'err' ? 'var(--accent)' : '';
}

async function saveKey(): Promise<void> {
  const input = $<HTMLInputElement>('key-input');
  const apiKey = input.value.trim();
  if (!apiKey) return keyStatus('Paste a key first.', 'err');

  const s = await saveSettings({ apiKey });
  editingKey = false;
  input.value = '';
  void render(s);

  // Verify with one tiny Jev call so a typo shows up here, not as silent failures on YouTube.
  keyStatus('Saved. Checking the key…', 'muted');
  try {
    const res = (await browser.runtime.sendMessage({ type: 'testKey', apiKey, model: s.model } satisfies Message)) as TestKeyResponse;
    if (res.ok) keyStatus('Key works. Reload YouTube to start.', 'ok');
    else keyStatus(res.error, 'err');
  } catch (e) {
    keyStatus(`Couldn't check the key: ${e instanceof Error ? e.message : e}`, 'err');
  }
}

$('key-save').addEventListener('click', () => void saveKey());
$<HTMLInputElement>('key-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void saveKey();
});
$('key-change').addEventListener('click', async () => {
  editingKey = true;
  $('key-status').hidden = true;
  await render(await getSettings());
  $<HTMLInputElement>('key-input').focus();
});

$('open-options').addEventListener('click', () => void browser.runtime.openOptionsPage());

void getSettings().then(render);
