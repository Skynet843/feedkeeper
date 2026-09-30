import { browser } from 'wxt/browser';
import { categoriesToScore } from './categories';
import { estimateCost, systemOne } from './jev';
import { buildJevRequest, QUESTION_VERSION } from './request';
import { bumpStats } from './storage';
import type { Category, Scores, Settings, VideoDetails, VideoMeta } from './types';

// v3: details now carry chapters and drop sponsor text. Older entries are dropped by pruneCache.
const CACHE_PREFIX = 'cls3:';
const LEGACY_PREFIXES = ['cls:', 'cls2:'];
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 4;

interface CacheEntry {
  ts: number;
  /** Keyed by questionKey(category), so editing a description re-asks only that category. */
  scores: Record<string, number>;
  /** YouTube description/tags/category, kept so new categories don't need another YouTube fetch. */
  details?: VideoDetails;
}

/** Returns null when details are wanted but haven't been fetched yet (see ClassifyResponse.needDetails). */
export async function classify(video: VideoMeta, settings: Settings, inspect = false): Promise<Scores | null> {
  const cats = categoriesToScore(settings, inspect);
  if (cats.length === 0) return {};

  const cacheKey = CACHE_PREFIX + video.videoId;
  const { [cacheKey]: raw } = await browser.storage.local.get(cacheKey);
  const cached = raw as CacheEntry | undefined;
  const valid = cached && Date.now() - cached.ts < CACHE_TTL_MS ? cached : undefined;
  const known = valid?.scores ?? {};

  const missing = cats.filter((c) => !(questionKey(c) in known));
  if (missing.length > 0 && settings.useDescription && video.details === undefined) {
    if (!valid?.details) return null; // caller fetches details from YouTube and asks again
    video = { ...video, details: valid.details };
  }

  let fresh: Record<string, number> = {};
  if (missing.length > 0) {
    fresh = await limit(() => askJev(video, missing, settings));
    // Another request scope (normal vs inspect) may have completed while this call was in flight.
    // Re-read before writing so neither request can erase the other's category scores.
    const { [cacheKey]: latestRaw } = await browser.storage.local.get(cacheKey);
    const latest = latestRaw as CacheEntry | undefined;
    const latestScores = latest && Date.now() - latest.ts < CACHE_TTL_MS ? latest.scores : {};
    const entry: CacheEntry = { ts: Date.now(), scores: { ...known, ...latestScores, ...fresh } };
    const details = video.details ?? latest?.details ?? valid?.details; // a failed fetch (null) isn't cached, so it's retried later
    if (details) entry.details = details;
    await browser.storage.local.set({ [cacheKey]: entry });
  }

  const all = { ...known, ...fresh };
  return Object.fromEntries(cats.map((c) => [c.id, all[questionKey(c)] ?? 0]));
}

async function askJev(video: VideoMeta, cats: Category[], settings: Settings): Promise<Record<string, number>> {
  const { body, names } = buildJevRequest(video, cats, settings.model);
  const res = await systemOne(settings.apiKey, body);

  void bumpStats({ requests: 1, inputTokens: res.usage.input_tokens, costUsd: estimateCost(res) });

  const out: Record<string, number> = {};
  for (const [name, c] of names) {
    const a = res.answers[name];
    if (a && typeof a.noul === 'number') out[questionKey(c)] = a.noul;
  }
  return out;
}

export function questionKey(c: Category): string {
  return `${c.id}@${hash(`${QUESTION_VERSION}|${c.label}|${c.description}`)}`;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Simple concurrency limiter so a freshly loaded feed doesn't fire 30 requests at once.
let active = 0;
const waiting: (() => void)[] = [];
async function limit<T>(fn: () => Promise<T>): Promise<T> {
  // A finishing task hands its slot straight to the next waiter, so `active` never overshoots.
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/** The YouTube details cached with a video's scores, if any; used to export corrections without refetching. */
export async function cachedDetails(videoId: string): Promise<VideoDetails | undefined> {
  const key = CACHE_PREFIX + videoId;
  const { [key]: raw } = await browser.storage.local.get(key);
  return (raw as CacheEntry | undefined)?.details;
}

export async function clearCache(): Promise<number> {
  const all = await browser.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await browser.storage.local.remove(keys);
  return keys.length;
}

/** Drops expired entries; called once per service-worker start. */
export async function pruneCache(): Promise<void> {
  const all = await browser.storage.local.get(null);
  const now = Date.now();
  const stale = Object.entries(all)
    .filter(
      ([k, v]) =>
        LEGACY_PREFIXES.some((p) => k.startsWith(p)) ||
        (k.startsWith(CACHE_PREFIX) && now - ((v as CacheEntry).ts ?? 0) > CACHE_TTL_MS),
    )
    .map(([k]) => k);
  if (stale.length) await browser.storage.local.remove(stale);
}
