export type Mode = 'preview' | 'hide' | 'auto';
export type FilterDirection = 'block' | 'allow';
export type MatchMethod = 'combined' | 'individual';
export type UncertainBehavior = 'show' | 'dim' | 'hide';

export interface Category {
  id: string;
  label: string;
  /** Sent to Jev as the question text, so write it as a clear definition. */
  description: string;
  /** Heading the category is listed under in the popup and settings. */
  group: string;
  /** Selected as a target for the current block or allow-only filter. */
  enabled: boolean;
  builtin: boolean;
  /** The user edited a builtin's description in Settings. */
  customized?: boolean;
}

export interface Pacing {
  minDelayMs: number;
  maxDelayMs: number;
  maxPerMinute: number;
  maxPerSession: number;
}

export interface FilterProfile {
  id: string;
  name: string;
  filterDirection: FilterDirection;
  threshold: number;
  categoryIds: string[];
}

export interface FocusSession {
  until: number;
  profileName: string;
  restore: FilterSnapshot;
}

/** The filter a focus session replaced, restored when it ends. */
export interface FilterSnapshot {
  filterDirection: FilterDirection;
  threshold: number;
  categoryIds: string[];
  /** Allow-only profiles switch Auto remove to Hide; missing on sessions saved before 0.2. */
  mode?: Mode;
}

export interface Settings {
  enabled: boolean;
  mode: Mode;
  apiKey: string;
  model: string;
  /** A video matches a category when Jev's yes-probability is at or above this. */
  threshold: number;
  /** Block selected categories, or hide everything except selected categories. */
  filterDirection: FilterDirection;
  /** A direct "any selected category" decision avoids confidence splitting across overlapping categories. */
  matchMethod: MatchMethod;
  categories: Category[];
  /** Lowercased channel names that are never classified or actioned. */
  allowlist: string[];
  /** Lowercased channel names that are always filtered. Allowlist wins on conflicts. */
  blocklist: string[];
  /** Case-insensitive title rules evaluated locally before a paid classification. */
  allowedKeywords: string[];
  blockedKeywords: string[];
  alwaysShowVideos: string[];
  alwaysHideVideos: string[];
  surfaces: { home: boolean; watch: boolean };
  /** Hide every Short on YouTube (shelves, tiles, search and the Shorts nav entry); hidden Shorts are never classified. */
  blockShorts: boolean;
  uncertainBehavior: UncertainBehavior;
  uncertainMargin: number;
  historyEnabled: boolean;
  profiles: FilterProfile[];
  focusSession?: FocusSession;
  pacing: Pacing;
  /** Fetch each video's description, tags and YouTube category and give them to Jev too. */
  useDescription: boolean;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
  /** e.g. "12:34"; empty for Shorts and live. */
  duration: string;
  /** e.g. "616K views · 8h ago" */
  meta: string;
  isShort: boolean;
  /** Present once the content script has tried fetching details (null if that failed). */
  details?: VideoDetails | null;
}

export interface VideoDetails {
  /** Cleaned of sponsor/link/boilerplate text and truncated. */
  description: string;
  /** Chapter titles from the description's timestamps, joined with " · ". */
  chapters: string;
  keywords: string[];
  /** The category the uploader picked on YouTube, e.g. "Education". */
  youtubeCategory: string;
  /** Channel name; the Shorts shelf doesn't show it on the tile. */
  author: string;
}

/** Jev yes-probability per category id. */
export type Scores = Record<string, number>;

export interface DayStats {
  scanned: number;
  matched: number;
  actioned: number;
  requests: number;
  inputTokens: number;
  costUsd: number;
}

export interface DecisionHistoryEntry {
  videoId: string;
  title: string;
  channel: string;
  at: number;
  action: 'would-filter' | 'hidden' | 'removed';
  reason: string;
  score?: number;
}

export type Message =
  | { type: 'classify'; video: VideoMeta; inspect?: boolean }
  | { type: 'testKey'; apiKey: string; model: string }
  | { type: 'countScanned' }
  | { type: 'countMatch' }
  | { type: 'countActioned' }
  | { type: 'clearCache' };

export type ClassifyResponse =
  | { ok: true; scores: Scores }
  /** Some scores aren't cached yet; resend the video with `details` filled in. */
  | { ok: true; needDetails: true }
  | { ok: false; error: string };
export type TestKeyResponse = { ok: true; noul: number; model: string } | { ok: false; error: string };
