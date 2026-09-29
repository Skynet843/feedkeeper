// Fetches a video's description, tags and YouTube category through YouTube's own
// player endpoint (the same one the page uses). Runs in the content script so the
// request is same-origin with the user's session. About 10–15 KB and ~250 ms per video.

import type { VideoDetails } from './types';
import { parsePlayerResponse } from './video-text';

const PLAYER_URL = '/youtubei/v1/player?prettyPrint=false';
/** Used when the page's config can't be read; YouTube accepts slightly old versions. */
const FALLBACK_CLIENT_VERSION = '2.20260925.01.00';
const MAX_CONCURRENT = 3;

let client: { clientName: 'WEB'; clientVersion: string; hl?: string; gl?: string } | undefined;

function clientContext() {
  if (!client) {
    // ytcfg lives in the page's JS world, which content scripts can't reach; read it from the inline scripts.
    const src = [...document.scripts].map((s) => s.textContent ?? '').join('\n');
    client = {
      clientName: 'WEB',
      clientVersion: src.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/)?.[1] ?? FALLBACK_CLIENT_VERSION,
      hl: src.match(/"HL":"([\w-]+)"/)?.[1],
      gl: src.match(/"GL":"(\w+)"/)?.[1],
    };
  }
  return client;
}

export async function fetchDetails(videoId: string): Promise<VideoDetails | null> {
  return limit(async () => {
    try {
      const res = await fetch(PLAYER_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: clientContext() }, videoId }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      return parsePlayerResponse(await res.json());
    } catch {
      return null;
    }
  });
}

let active = 0;
const waiting: (() => void)[] = [];
async function limit<T>(fn: () => Promise<T>): Promise<T> {
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
