// Measures classification accuracy on real YouTube videos with hand-assigned labels.
//
//   node scripts/category-eval.mjs --fetch      freeze YouTube metadata for cases that lack it (free)
//   node scripts/category-eval.mjs --dry-run    build every request without calling Jev (free)
//   node --env-file=.env scripts/category-eval.mjs [--threshold 0.75] [--model jev-1.13] [--only text]
//        paid run; raw answers are saved to output/category-eval.json (or --out path)
//   --no-details
//        send only title, channel and duration, to measure what descriptions are worth
//   --title output/category-eval-title.json
//        with a full run: simulate asking with the title first and re-asking with details only when the
//        title-only answer is within --title-band of the threshold; reports accuracy and input tokens
//   --corrections feedkeeper-corrections.json [--dry-run]
//        replay corrections exported from Settings: each video is asked with the filter it was judged under
//        (built-in definitions from --defs, custom or edited ones as exported) and checked against your choice
//   --ask-each
//        also ask each selected category next to the combined question (the extension before 1.1)
//   node scripts/category-eval.mjs --from output/category-eval.json [--threshold 0.8]
//        re-analyse saved answers without new requests
//   --split dev|holdout|holdout2|holdout3|holdout4 (comma-separated for several)
//        only the cases definitions were tuned on (dev), or ones kept aside to check them (holdout*)
//   --defs path/to/categories.ts --request path/to/request.ts
//        score another version of the definitions or question wording (e.g. one exported from git)
//
// Each case lists `labels` (categories that clearly apply) and `maybe` (defensible either way). A scenario
// decision that depends only on a `maybe` label is not scored, so ambiguous calls don't count as mistakes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parsePlayerResponse } from '../lib/video-text.ts';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);

const CASES_URL = new URL('./category-cases.json', import.meta.url);
const noDetails = flag('no-details');
const OUT_URL = option('out')
  ? pathToFileURL(option('out'))
  : new URL(noDetails ? '../output/category-eval-title.json' : '../output/category-eval.json', import.meta.url);
const threshold = Number(option('threshold', '0.75')); // DEFAULT_SETTINGS.threshold
const margin = 0.2; // DEFAULT_SETTINGS.uncertainMargin
const model = option('model', 'jev-1.13');
const resolve = (p, fallback) => (p ? pathToFileURL(p).href : new URL(fallback, import.meta.url).href);
const { BUILTIN_CATEGORIES, combinedSelectionCategory } = await import(resolve(option('defs'), '../lib/categories.ts'));
const { buildJevRequest } = await import(resolve(option('request'), '../lib/request.ts'));

const SCENARIOS = [
  { name: 'Default selection', direction: 'block', ids: ['comedy', 'vlogs', 'challenges'] },
  { name: 'Block distractions', direction: 'block', ids: ['comedy', 'vlogs', 'challenges', 'reactions', 'drama', 'movies_tv', 'music', 'gaming', 'lifestyle'] },
  { name: 'Block politics, keep news', direction: 'block', ids: ['politics'] },
  { name: 'Only show learning', direction: 'allow', ids: ['education', 'tech'] },
];
const ALL = '(all categories)';

// Lets --defs score definitions from before a split against today's labels.
const LEGACY = { vlogs: 'entertainment', challenges: 'entertainment', reactions: 'entertainment', politics: 'news' };
const known = new Set(BUILTIN_CATEGORIES.map((c) => c.id));
const toDefs = (id) => (known.has(id) ? id : LEGACY[id]);
const labelsOf = (c) => c.labels.map(toDefs);
const maybeOf = (c) => (c.maybe ?? []).map(toDefs);
for (const s of SCENARIOS) s.selected = [...new Set(s.ids.map(toDefs))];

let cases = JSON.parse(await readFile(CASES_URL, 'utf8'));
for (const c of cases) {
  for (const id of [...c.labels, ...(c.maybe ?? [])]) if (!toDefs(id)) throw new Error(`${c.videoId}: unknown category "${id}"`);
}

if (option('corrections')) {
  await replayCorrections(JSON.parse(await readFile(option('corrections'), 'utf8')));
  process.exit(0);
}

if (flag('fetch')) {
  let fetched = 0;
  for (const c of cases) {
    if (c.details) continue;
    try {
      Object.assign(c, await fetchVideo(c.videoId));
      fetched++;
      console.log(`fetched ${c.videoId}  ${c.title}`);
    } catch (e) {
      console.warn(`skipped ${c.videoId}: ${e.message}`);
    }
  }
  await writeFile(CASES_URL, JSON.stringify(cases, null, 2) + '\n');
  console.log(`${fetched} fetched; ${cases.filter((c) => !c.details).length} still missing details.`);
  process.exit(0);
}

const missing = cases.filter((c) => !c.details);
if (missing.length) throw new Error(`${missing.length} cases lack details; run with --fetch first.`);
if (option('only')) cases = cases.filter((c) => `${c.videoId} ${c.title}`.toLowerCase().includes(option('only').toLowerCase()));
if (option('split')) cases = cases.filter((c) => option('split').split(',').includes(c.split ?? 'dev'));

// One request per scenario, exactly as normal scanning sends it, plus one with every category (like Why?).
function requestsFor(c) {
  const video = { videoId: c.videoId, title: c.title, channel: c.channel, duration: c.duration, meta: '', isShort: c.isShort, details: noDetails ? undefined : c.details };
  const out = [];
  for (const s of SCENARIOS) {
    const categories = BUILTIN_CATEGORIES.map((b) => ({ ...b, enabled: s.selected.includes(b.id) }));
    const combined = combinedSelectionCategory?.({ categories, matchMethod: 'combined' });
    // Mirrors categoriesToScore: the combined question alone when it applies, otherwise each selected category.
    const selected = categories.filter((b) => b.enabled);
    const cats = combined ? (flag('ask-each') ? [...selected, combined] : [combined]) : selected;
    out.push({ scope: s.name, ...buildJevRequest(video, cats, model) });
  }
  // Why? always fetches details first, so a title-only run has no use for the full distribution.
  if (!noDetails) out.push({ scope: ALL, ...buildJevRequest(video, BUILTIN_CATEGORIES, model) });
  return out;
}

if (flag('dry-run')) {
  const requests = cases.flatMap(requestsFor);
  const chars = requests.reduce((n, r) => n + JSON.stringify(r.body).length, 0);
  console.log(`${cases.length} cases → ${requests.length} requests, ~${Math.round(chars / 4 / 1000)}k input tokens. Nothing sent.`);
  process.exit(0);
}

let saved;
if (option('from')) {
  saved = JSON.parse(await readFile(option('from'), 'utf8'));
} else {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Set OPENROUTER_API_KEY (e.g. node --env-file=.env …), or use --dry-run / --from.');
  const jobs = cases.flatMap((c) => requestsFor(c).map((r) => ({ c, r })));
  let cost = 0;
  let done = 0;
  const answers = {};
  const tokens = {};
  await pool(jobs, 4, async ({ c, r }) => {
    const res = await ask(key, r.body);
    cost += res.usage?.cost || res.usage.input_tokens * 0.042e-6; // BYOK keys report 0
    const scores = Object.fromEntries([...r.names].map(([name, cat]) => [cat.id, res.answers?.[name]?.noul]));
    ((answers[c.videoId] ??= {})[r.scope] = scores);
    ((tokens[c.videoId] ??= {})[r.scope] = res.usage?.input_tokens);
    if (++done % 20 === 0 || done === jobs.length) process.stderr.write(`\r${done}/${jobs.length} requests`);
  });
  process.stderr.write('\n');
  saved = { model, at: new Date().toISOString(), defs: option('defs') ?? 'lib/categories.ts', details: !noDetails, costUsd: cost, answers, tokens };
  await mkdir(new URL('.', OUT_URL), { recursive: true });
  await writeFile(OUT_URL, JSON.stringify(saved, null, 2) + '\n');
}

report(saved);
if (option('title')) titleFirst(saved, JSON.parse(await readFile(option('title'), 'utf8')));

// ---------------------------------------------------------------------------------------------------------

// Scores a scenario's saved answers the way the extension decides: the best of the combined and single scores.
function decisionScore(s, ids) {
  return Math.max(s.__selected_categories__ ?? 0, ...ids.map((id) => s[id] ?? 0));
}

/** Cases scored for a scenario, skipping ones whose only relevant label is a `maybe`. */
function rowsFor(sc, scored, answers) {
  const rows = [];
  for (const c of scored) {
    const definite = c.labels.some((id) => sc.ids.includes(id));
    const possible = definite || (c.maybe ?? []).some((id) => sc.ids.includes(id));
    if (!definite && possible) continue; // ambiguous for this selection
    rows.push({ c, match: definite, s: answers[c.videoId][sc.name] ?? {} });
  }
  return rows;
}

function report(saved) {
  const { answers, costUsd, model: m, defs } = saved;
  const summary = { right: 0, rows: 0, hid: 0, shown: 0 };
  const scored = cases.filter((c) => answers[c.videoId]);
  const pct = (n) => `${Math.round(n * 100)}%`;
  console.log(`model ${m} · definitions ${defs} · ${scored.length} videos${option('split') ? ` (${option('split')})` : ''} · threshold ${pct(threshold)}` +
    (costUsd === undefined ? '' : ` · cost $${costUsd.toFixed(4)}`));

  const METHODS = {
    'combined only': (s, ids) => s.__selected_categories__ ?? Math.max(...ids.map((id) => s[id] ?? 0)),
    'best single': (s, ids) => Math.max(...ids.map((id) => s[id] ?? 0)),
    'max of both': (s, ids) => Math.max(s.__selected_categories__ ?? 0, ...ids.map((id) => s[id] ?? 0)),
  };

  const sweep = [];
  for (const sc of SCENARIOS) {
    const rows = rowsFor(sc, scored, answers);
    console.log(`\n## ${sc.name} (${sc.direction === 'block' ? 'block' : 'allow only'}: ${sc.ids.join(', ')}) · ${rows.length} scored`);
    const hasCombined = rows.some((r) => r.s.__selected_categories__ !== undefined);
    const hasSingles = rows.some((r) => sc.selected.some((id) => r.s[id] !== undefined));
    const available = { 'combined only': hasCombined, 'best single': hasSingles, 'max of both': hasCombined && hasSingles };
    const finalMethod = available['max of both'] ? 'max of both' : hasCombined ? 'combined only' : 'best single';
    for (const [method, score] of Object.entries(METHODS)) {
      if (!available[method]) continue;
      const wrongHidden = [];
      const wrongShown = [];
      let borderline = 0;
      for (const { c, match, s } of rows) {
        const p = score(s, sc.selected);
        const predicted = p >= threshold;
        if (!predicted && p >= threshold - margin) borderline++;
        if (predicted === match) continue;
        // In block mode a false match hides a wanted video; in allow mode a missed match does.
        const hidden = sc.direction === 'block' ? predicted : !predicted;
        (hidden ? wrongHidden : wrongShown).push(`${pct(p).padStart(4)}  ${c.title.slice(0, 70)}  [${c.labels.join(', ')}]`);
      }
      const right = rows.length - wrongHidden.length - wrongShown.length;
      if (method === finalMethod) Object.assign(summary, { right: summary.right + right, rows: summary.rows + rows.length, hid: summary.hid + wrongHidden.length, shown: summary.shown + wrongShown.length });
      console.log(`  ${method.padEnd(14)} ${right}/${rows.length} right · ${wrongHidden.length} wanted videos hidden · ${wrongShown.length} unwanted shown · ${borderline} borderline`);
      if (method === finalMethod || flag('verbose')) {
        for (const line of wrongHidden) console.log(`      hid   ${line}`);
        for (const line of wrongShown) console.log(`      show  ${line}`);
      }
    }
    const final = METHODS[finalMethod];
    sweep.push([sc.name, [0.5, 0.6, 0.7, 0.75, 0.8, 0.9].map((t) => rows.filter(({ match, s }) => (final(s, sc.selected) >= t) === match).length / rows.length)]);
  }

  console.log('\n## Threshold sweep: share of scored videos decided correctly (the method the extension uses)');
  console.log(`  ${''.padEnd(26)}${[50, 60, 70, 75, 80, 90].map((t) => `${t}%`.padStart(6)).join('')}`);
  for (const [name, accs] of sweep) console.log(`  ${name.padEnd(26)}${accs.map((a) => pct(a).padStart(6)).join('')}`);

  console.log(`\n## Per category at ${pct(threshold)} (each category asked on its own; "maybe" labels not scored)`);
  console.log(`  ${'category'.padEnd(26)}${'precision'.padStart(10)}${'recall'.padStart(8)}   mistakes`);
  for (const cat of BUILTIN_CATEGORIES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const notes = [];
    for (const c of scored) {
      if (maybeOf(c).includes(cat.id)) continue;
      const p = answers[c.videoId][ALL]?.[cat.id];
      if (p === undefined) continue;
      const label = labelsOf(c).includes(cat.id);
      const predicted = p >= threshold;
      if (label && predicted) tp++;
      else if (!label && predicted) (fp++, notes.push(`+${c.title.slice(0, 32)} ${pct(p)}`));
      else if (label && !predicted) (fn++, notes.push(`-${c.title.slice(0, 32)} ${pct(p)}`));
    }
    const precision = tp + fp ? pct(tp / (tp + fp)) : '—';
    const recall = tp + fn ? pct(tp / (tp + fn)) : '—';
    console.log(`  ${cat.label.padEnd(26)}${precision.padStart(10)}${recall.padStart(8)}   ${notes.slice(0, 4).join(' · ')}${notes.length > 4 ? ` · +${notes.length - 4} more` : ''}`);
  }
  console.log('\n  + scored as this category but not labelled; - labelled but scored below the threshold');
  summary.categories = { tp: 0, fp: 0, fn: 0 };
  for (const cat of BUILTIN_CATEGORIES) {
    for (const c of scored) {
      const p = answers[c.videoId][ALL]?.[cat.id];
      if (p === undefined || maybeOf(c).includes(cat.id)) continue;
      const label = labelsOf(c).includes(cat.id);
      if (p >= threshold) summary.categories[label ? 'tp' : 'fp']++;
      else if (label) summary.categories.fn++;
    }
  }
  const avg = (scope) => {
    const t = scored.map((c) => saved.tokens?.[c.videoId]?.[scope]).filter((x) => x !== undefined);
    return t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : '?';
  };
  const { tp, fp, fn } = summary.categories;
  console.log(`\n## Summary: scans ${summary.right}/${summary.rows} right · ${summary.hid} wanted hidden · ${summary.shown} unwanted shown` +
    ` · Why? precision ${tp + fp ? pct(tp / (tp + fp)) : '—'} recall ${tp + fn ? pct(tp / (tp + fn)) : '—'} (${fp} false, ${fn} missed)` +
    ` · tokens per scan ${SCENARIOS.map((sc) => avg(sc.name)).join('/')} · per Why? ${avg(ALL)}`);
}

/**
 * Simulates the extension's title-first flow from a full run and a --no-details run of the same cases: the
 * title-only answer stands unless it is within `band` of the threshold, when the video is asked again with details.
 */
function titleFirst(full, title) {
  const pct = (n) => `${Math.round(n * 100)}%`;
  const scored = cases.filter((c) => full.answers[c.videoId] && title.answers[c.videoId]);
  const bands = option('title-band') ? [Number(option('title-band'))] : [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const tok = (run, c, scope) => run.tokens?.[c.videoId]?.[scope];
  console.log(`\n## Title first at ${pct(threshold)}: title-only answer kept unless within the band of the threshold`);
  console.log(`  ${'scenario'.padEnd(26)}${'band'.padStart(6)}${'right'.padStart(10)}${'hid'.padStart(6)}${'shown'.padStart(7)}${'re-asked'.padStart(10)}${'tokens'.padStart(9)}`);
  for (const sc of SCENARIOS) {
    const rows = rowsFor(sc, scored, full.answers);
    const fullTokens = rows.reduce((n, { c }) => n + (tok(full, c, sc.name) ?? 0), 0);
    const line = (label, band) => {
      let right = 0;
      let hid = 0;
      let shown = 0;
      let reasked = 0;
      let tokens = 0;
      for (const { c, match, s } of rows) {
        const t = title.answers[c.videoId][sc.name] ?? {};
        const pt = decisionScore(t, sc.selected);
        const trusted = band !== undefined && Math.abs(pt - threshold) >= band;
        tokens += band === undefined ? tok(full, c, sc.name) ?? 0 : (tok(title, c, sc.name) ?? 0) + (trusted ? 0 : tok(full, c, sc.name) ?? 0);
        if (band !== undefined && !trusted) reasked++;
        const predicted = (trusted ? pt : decisionScore(s, sc.selected)) >= threshold;
        if (predicted === match) right++;
        else if ((sc.direction === 'block') === predicted) hid++;
        else shown++;
      }
      const saved = fullTokens ? ` ${tokens <= fullTokens ? '-' : '+'}${pct(Math.abs(1 - tokens / fullTokens))}` : '';
      console.log(`  ${label.padEnd(26)}${(band === undefined ? 'full' : String(band)).padStart(6)}${`${right}/${rows.length}`.padStart(10)}${String(hid).padStart(6)}${String(shown).padStart(7)}${(band === undefined ? '—' : pct(reasked / rows.length)).padStart(10)}${String(tokens).padStart(9)}${saved}`);
    };
    line(sc.name, undefined);
    for (const b of bands) line('', b);
  }
  console.log('  hid: wanted videos hidden · shown: unwanted videos shown · tokens: input tokens vs details on every request');
}

async function replayCorrections(file) {
  if (file.format !== 'feedkeeper-corrections') throw new Error('Not a FeedKeeper corrections export');
  const builtins = new Map(BUILTIN_CATEGORIES.map((b) => [b.id, b]));
  const jobs = [];
  for (const c of file.corrections) {
    if (!c.details) c.details = await fetchVideo(c.videoId).then((v) => v.details, () => undefined);
    // Built-ins the user didn't edit take the definitions under test; custom or edited ones keep their text.
    const selected = c.categories.map((x) =>
      x.builtin && !x.customized && builtins.has(x.id) ? { ...builtins.get(x.id), enabled: true } : { ...x, enabled: true, group: 'Custom' });
    const combined = c.matchMethod === 'combined' ? combinedSelectionCategory({ categories: selected, matchMethod: 'combined' }) : undefined;
    const video = { videoId: c.videoId, title: c.title, channel: c.channel, duration: c.duration, meta: '', isShort: false, details: c.details };
    jobs.push({ c, ids: selected.map((x) => x.id), ...buildJevRequest(video, combined ? [combined] : selected, model) });
  }
  if (flag('dry-run')) {
    const chars = jobs.reduce((n, j) => n + JSON.stringify(j.body).length, 0);
    console.log(`${jobs.length} corrections → ~${Math.round(chars / 4 / 1000)}k input tokens. Nothing sent.`);
    return;
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Set OPENROUTER_API_KEY (e.g. node --env-file=.env …), or use --dry-run.');
  let cost = 0;
  const rows = [];
  await pool(jobs, 4, async (j) => {
    const res = await ask(key, j.body);
    cost += res.usage?.cost || res.usage.input_tokens * 0.042e-6; // BYOK keys report 0
    const s = Object.fromEntries([...j.names].map(([name, cat]) => [cat.id, res.answers?.[name]?.noul]));
    const p = decisionScore(s, j.ids);
    const matched = p >= j.c.threshold;
    rows.push({ c: j.c, p, filtered: j.c.filterDirection === 'block' ? matched : !matched });
  });
  const pct = (n) => `${Math.round(n * 100)}%`;
  const ok = (filtered, c) => filtered === (c.want === 'hide');
  const before = rows.filter((r) => ok(r.c.wasFiltered, r.c)).length;
  const now = rows.filter((r) => ok(r.filtered, r.c)).length;
  console.log(`definitions ${option('defs') ?? 'lib/categories.ts'} · ${rows.length} corrections · cost $${cost.toFixed(4)}`);
  console.log(`  decided your way: ${now}/${rows.length} now, ${before}/${rows.length} when you corrected them`);
  for (const { c, p, filtered } of rows.sort((a, b) => Number(ok(a.filtered, a.c)) - Number(ok(b.filtered, b.c)))) {
    const mark = ok(filtered, c) ? (ok(c.wasFiltered, c) ? '  ok   ' : '  fixed') : '  wrong';
    console.log(`${mark}  want ${c.want.padEnd(4)} ${pct(p).padStart(4)}  ${c.title.slice(0, 70)}  [${c.categories.map((x) => x.id).join(', ')}]`);
  }
}

async function ask(key, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'FeedKeeper' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (res.ok) return res.json();
    const retryable = res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 3) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function fetchVideo(id) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20260925.01.00', hl: 'en' } }, videoId: id }),
  });
  const json = await res.json();
  const vd = json.videoDetails;
  if (!vd) throw new Error(json.playabilityStatus?.reason ?? 'no videoDetails');
  const secs = Number(vd.lengthSeconds);
  return {
    title: vd.title,
    channel: vd.author,
    duration: secs ? clock(secs) : '',
    isShort: false,
    details: parsePlayerResponse(json),
  };
}

function clock(secs) {
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(secs % 60)}` : `${m}:${pad(secs % 60)}`;
}
