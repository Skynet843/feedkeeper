// Minimal typed client for TypeSafe's System One API (Jev) served through OpenRouter.
// Shapes mirror @typesafe-ai/sdk 0.6.0; we use fetch directly because the SDK refuses
// browser-like runtimes unless `dangerouslyAllowBrowser` is set, and we only need one call.

export const JEV_ENDPOINT = 'https://openrouter.ai/api/v1/systemone';
/**
 * Used for the stats estimate when the response reports no cost, or $0 for a request that used tokens: with a
 * TypeSafe key attached to OpenRouter (BYOK), TypeSafe bills the request and OpenRouter reports 0.
 */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

type Entry = string | Record<string, unknown> | unknown[] | null;

export interface NoulQuestion {
  type: 'noul';
  instructions?: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface SystemOneResult {
  model: string;
  answers: Record<string, NoulAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export async function systemOne(
  apiKey: string,
  body: { model: string; state: Entry; questions: Record<string, NoulQuestion> },
  { timeoutMs = 15_000, retries = 2 } = {},
): Promise<SystemOneResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(apiKey, body, timeoutMs);
    } catch (e) {
      const err = e instanceof JevError ? e : new JevError(String(e));
      const retryable = err.status === undefined || err.status === 408 || err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= retries) throw err;
      await sleep(err.retryAfterMs ?? 500 * 2 ** attempt);
    }
  }
}

async function attemptOnce(apiKey: string, body: unknown, timeoutMs: number): Promise<SystemOneResult> {
  const res = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'FeedKeeper',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch {}
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new JevError(`Jev ${res.status}: ${message}`, res.status, retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
  return JSON.parse(text) as SystemOneResult;
}

export function estimateCost(r: SystemOneResult): number {
  return r.usage.cost || r.usage.input_tokens * USD_PER_INPUT_TOKEN;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
