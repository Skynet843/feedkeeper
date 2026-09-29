// Sends Jev exactly the request the extension sends (same builder, same categories),
// so API errors and accuracy can be checked from the terminal.
//
// Usage: OPENROUTER_API_KEY=sk-or-... pnpm spike [--video ID[,ID…]] [--model jev-1.13] [--selected]
//   --video     score real YouTube videos (fetches title, description, chapters, tags like the extension)
//   --selected  only ask the default-selected categories (Hide/Auto modes) instead of all (Preview viewer)

import { BUILTIN_CATEGORIES } from '../lib/categories.ts';
import { buildJevRequest } from '../lib/request.ts';
import { parsePlayerResponse } from '../lib/video-text.ts';

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('Set OPENROUTER_API_KEY first, e.g.  OPENROUTER_API_KEY=sk-or-... pnpm spike');
  process.exit(1);
}
const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'jev-1.13';
const cats = args.includes('--selected') ? BUILTIN_CATEGORIES.filter((c) => c.enabled) : BUILTIN_CATEGORIES;

const video = (title, channel, extra = {}) => ({ videoId: 'x', title, channel, duration: '', meta: '', isShort: false, ...extra });
async function fetchVideo(id) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20260925.01.00', hl: 'en' } }, videoId: id }),
  });
  const json = await res.json();
  if (!json.videoDetails) throw new Error(`YouTube returned no details for ${id}`);
  const secs = Number(json.videoDetails.lengthSeconds);
  return video(json.videoDetails.title, json.videoDetails.author, {
    videoId: id,
    duration: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
    details: parsePlayerResponse(json),
  });
}

const videoIds = args.includes('--video') ? args[args.indexOf('--video') + 1].split(',') : null;
const SAMPLES = videoIds ? await Promise.all(videoIds.map(fetchVideo)) : [
  video('Try Not To Laugh Challenge #47 | Funniest Fails', 'LOL Daily'),
  video('RHITI MADE SALMAN ANGRY ON WEEKEND KA VAAR', 'Rajat here !'),
  video("Worst Ramayan I've Ever Seen", 'PJ Explained'),
  video('But what is a neural network? | Deep learning chapter 1', '3Blue1Brown'),
  video('IRCTC Tatkal Ticket Booking Trick', 'iRohit', {
    details: { description: 'How to book tatkal tickets fast on IRCTC. Step by step guide.', keywords: ['irctc', 'tatkal'], youtubeCategory: 'Education', author: 'iRohit' },
  }),
  video('Dark reality of Asbestos!', 'Vigyan Recharge', { isShort: true }),
];
const verbose = !!videoIds;

console.log(`model ${model} · ${cats.length} categories per request\n`);
let cost = 0;
let first = true;
for (const v of SAMPLES) {
  const { body, names } = buildJevRequest(v, cats, model);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'FeedKeeper' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('Network error:', e.message);
    process.exit(1);
  }
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.error(`HTTP ${res.status} after ${ms}ms for "${v.title}"\n${text}`);
    process.exit(1);
  }
  const json = JSON.parse(text);
  if (first && !verbose) {
    console.log('First response (truncated):', text.slice(0, 400), '\n');
    first = false;
  }
  cost += json.usage?.cost ?? json.usage.input_tokens * 0.042e-6;
  const scores = [...names]
    .map(([name, c]) => [c.label, json.answers?.[name]?.noul])
    .filter(([, p]) => typeof p === 'number')
    .sort((a, b) => b[1] - a[1]);
  const missing = names.size - scores.length;
  const fmt = (list) => list.map(([l, p]) => `${l} ${Math.round(p * 100)}%`).join(', ');
  console.log(`${String(ms).padStart(5)}ms  ${json.usage.input_tokens} tok  ${v.title}${missing ? `  (⚠ ${missing} answers missing)` : ''}`);
  if (verbose) {
    console.log('  Jev saw:', JSON.stringify(body.state, null, 2).replace(/\n/g, '\n  '));
    console.log('  Scores:  ' + fmt(scores) + '\n');
  } else {
    console.log('         → ' + fmt(scores.slice(0, 3)));
  }
}
console.log(`\nTotal cost $${cost.toFixed(6)}`);
