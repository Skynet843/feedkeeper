// Turns YouTube's player response into the compact text Jev sees. Pure (no DOM or
// extension APIs) so `pnpm spike --video` can use the exact same logic from Node.

import type { VideoDetails } from './types';

const MAX_DESCRIPTION_CHARS = 500;
const MAX_CHAPTERS_CHARS = 700;
const MAX_KEYWORDS = 15;

// Lines that are about the creator's business, not the video's topic.
const PROMO =
  /sponsor|promo|coupon|discount|use (my )?code|\bcode\s*[:\-]|affiliate|giveaway|prize|deposit|register|sign ?up|download|install|subscribe|follow (me|us)|instagram|facebook|twitter|telegram|whatsapp|discord|patreon|membership|join (this|our|the)|business (email|inquir|enquir)|\b[\w.-]+@[\w-]+\.\w+|e-?mail|contact|merch|disclaimer|copyright|fair use|filming setup|my (gear|setup)|thumbnail by|edited by|created with|links? (below|in)|→|\$\d|₹\s?\d|\d+% off/i;
const TIMESTAMP = /^\s*[([]?(?:\d{1,2}:)?\d{1,2}:\d{2}[)\]]?\s*[-–—:|.]?\s*(.+)$/;

export function parsePlayerResponse(json: unknown): VideoDetails | null {
  const j = json as {
    videoDetails?: { shortDescription?: string; keywords?: unknown; author?: string };
    microformat?: { playerMicroformatRenderer?: { category?: string } };
  };
  const vd = j?.videoDetails;
  if (!vd) return null;
  const { description, chapters } = splitDescription(vd.shortDescription ?? '');
  return {
    description,
    chapters,
    keywords: Array.isArray(vd.keywords) ? vd.keywords.slice(0, MAX_KEYWORDS).map(String) : [],
    youtubeCategory: j.microformat?.playerMicroformatRenderer?.category ?? '',
    author: vd.author ?? '',
  };
}

/**
 * Chapters are the best summary of what a video covers, so they're pulled out on their own.
 * Promotional paragraphs (sponsors, links, gear, socials, legal boilerplate) are dropped.
 */
export function splitDescription(raw: string): { description: string; chapters: string } {
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map(cleanLine).filter((l): l is string => !!l))
    .filter((lines) => lines.length > 0);

  const chapters: string[] = [];
  const kept: string[] = [];
  for (const lines of paragraphs) {
    const stamped = lines.map((l) => l.match(TIMESTAMP)?.[1]).filter((t): t is string => !!t);
    if (stamped.length >= 2) {
      chapters.push(...stamped.map(tidy).filter((t) => t && !/^(intro|outro|end|credits)$/i.test(t)));
      continue;
    }
    const promo = lines.filter((l) => PROMO.test(l)).length;
    // Short paragraphs with any promo line, or mostly-promo ones, are the creator's plugs.
    if (promo > 0 && (lines.length <= 4 || promo / lines.length >= 0.4)) continue;
    // "To enter:", "Links:" style headers left over from dropped blocks.
    const content = lines.filter((l) => !PROMO.test(l) && !(l.length < 20 && l.endsWith(':')));
    if (content.length) kept.push(content.join(' '));
  }

  return {
    description: clip(kept.join('\n'), MAX_DESCRIPTION_CHARS),
    chapters: clip(chapters.join(' · '), MAX_CHAPTERS_CHARS),
  };
}

const LINK = /https?:\/\/\S+|www\.\S+/g;

/** Strips links; a line that was only a label for a link ("Gaming Channel - <url>") is dropped. */
function cleanLine(line: string): string | null {
  const hadLink = LINK.test(line);
  LINK.lastIndex = 0;
  const text = line.replace(LINK, '').replace(/[ \t]+/g, ' ').trim();
  if (!text) return null;
  if (hadLink && text.length < 40) return null;
  return text;
}

/** "Spider-Man ki Series!!??????" → "Spider-Man ki Series!" */
function tidy(s: string): string {
  return s
    .replace(/([!?.])[!?.]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s;
}
