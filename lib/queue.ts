import type { Pacing } from './types';

interface Job {
  key: string;
  /** 'retry' re-queues the job; 'skip' means nothing was clicked, so it doesn't count toward the caps. */
  run: () => Promise<'retry' | 'skip' | void>;
}

/**
 * Runs jobs one at a time with random gaps and per-minute / per-session caps,
 * so automated clicks look like a person working through the feed.
 */
export class PacedQueue {
  private jobs: Job[] = [];
  private keys = new Set<string>();
  private recent: number[] = [];
  private sessionCount = 0;
  private running = false;

  constructor(private getPacing: () => Pacing) {}

  push(key: string, run: Job['run']): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.jobs.push({ key, run });
    void this.drain();
  }

  /** Drops queued jobs, e.g. when the mode changes or the user navigates. */
  clear(): void {
    this.jobs = [];
    this.keys.clear();
  }

  get size(): number {
    return this.jobs.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length > 0) {
        const p = this.getPacing();
        if (this.sessionCount >= p.maxPerSession) {
          console.info('[FeedKeeper] Session cap reached; reload the page to continue.');
          this.clear();
          break;
        }

        await sleep(p.minDelayMs + Math.random() * Math.max(0, p.maxDelayMs - p.minDelayMs));

        const now = Date.now();
        this.recent = this.recent.filter((t) => now - t < 60_000);
        if (this.recent.length >= p.maxPerMinute) {
          await sleep(60_000 - (now - this.recent[0]!));
          continue;
        }

        const job = this.jobs.shift();
        if (!job) break;
        const outcome = await job.run().catch((e) => console.warn('[FeedKeeper] action failed', e));
        if (outcome === 'retry') {
          this.jobs.push(job);
          continue;
        }
        this.keys.delete(job.key);
        if (outcome === 'skip') continue;
        this.recent.push(Date.now());
        this.sessionCount++;
      }
    } finally {
      this.running = false;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
