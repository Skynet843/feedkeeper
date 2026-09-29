import { SEL } from './selectors';
import type { VideoMeta } from './types';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The element itself or its first matching descendant (sidebar tiles are the lockup itself). */
const find = (tile: Element, sel: string) => (tile.matches(sel) ? tile : tile.querySelector(sel));
const VIDEO_ID = /^[\w-]{11}$/;

/** Reads a home-feed or sidebar tile into VideoMeta, or null for ads, playlists, placeholders and unknown layouts. */
export function extractVideo(tile: Element): VideoMeta | null {
  if (tile.querySelector(SEL.ad)) return null;

  const shorts = find(tile, SEL.shorts);
  if (shorts) {
    const href = shorts.querySelector(SEL.shortsLink)?.getAttribute('href') ?? '';
    const videoId = href.match(/^\/shorts\/([\w-]{6,})/)?.[1];
    const title = text(shorts.querySelector(SEL.shortsTitle));
    if (!videoId || !title) return null;
    // The Shorts shelf doesn't show the channel name.
    return { videoId, title, channel: '', duration: '', meta: '', isShort: true };
  }

  const lockup = find(tile, SEL.lockup);
  if (!lockup) return null;

  const hostClass = [...(lockup.querySelector(SEL.lockupHost)?.classList ?? [])].find((c) => c.startsWith('content-id-'));
  // Mixes and playlists carry a playlist id here; their first video isn't what the tile is about.
  const href = lockup.querySelector(SEL.lockupThumb)?.getAttribute('href') ?? '';
  const videoId = hostClass ? hostClass.slice('content-id-'.length) : href.match(/[?&]v=([\w-]{6,})/)?.[1];
  if (!videoId || !VIDEO_ID.test(videoId)) return null;
  const title = text(lockup.querySelector(SEL.lockupTitle));
  if (!title) return null;

  const channel =
    text(lockup.querySelector(SEL.lockupChannelLink)) ||
    (lockup.querySelector(SEL.lockupAvatar)?.getAttribute('aria-label') ?? '').replace(/^Go to channel\s*/, '');

  // Rows look like "Channel 616K 8h ago", then optional extras ("Auto-dubbed", "Playlist").
  const rows = [...lockup.querySelectorAll(SEL.lockupMetaRow)].map(text);
  if (channel && rows[0]?.startsWith(channel)) rows[0] = rows[0].slice(channel.length).trim();
  const meta = rows.filter(Boolean).join(' · ');
  // Badge is a duration ("12:34") for videos, or a word like "Mix" / "LIVE" otherwise.
  const badge = text(lockup.querySelector(SEL.lockupDuration));
  const duration = /^\d/.test(badge) ? badge : '';

  return { videoId, title, channel, duration, meta: badge && !duration ? `${badge} · ${meta}` : meta, isShort: false };
}

export function thumbnailOf(tile: Element): HTMLElement | null {
  return tile.querySelector<HTMLElement>(`${SEL.lockupThumb}, ${SEL.shortsThumb}`);
}

export function menuButtonOf(tile: Element): HTMLElement | null {
  return tile.querySelector<HTMLElement>(`${SEL.lockupMenuButton}, ${SEL.shortsMenuButton}`);
}
