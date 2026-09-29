import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { classify, clearCache, pruneCache } from '@/lib/classifier';
import { systemOne } from '@/lib/jev';
import { bumpStats, getSettings } from '@/lib/storage';
import type { ClassifyResponse, Message, Scores, TestKeyResponse } from '@/lib/types';

export default defineBackground(() => {
  void pruneCache();

  // The same video can be requested twice while the first call is still in flight
  // (duplicate tiles, re-scans after navigation); share one request between them.
  const inflight = new Map<string, Promise<Scores | null>>();

  // Chrome stops a worker after 30 s without extension API calls, and a pending reply doesn't count. Slow or
  // rate-limited Jev calls can wait that long, which would drop every waiting tile's reply, so ping while busy.
  let pending = 0;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  async function stayAwake<T>(work: Promise<T>): Promise<T> {
    if (pending++ === 0) keepAlive = setInterval(() => void browser.runtime.getPlatformInfo(), 20_000);
    try {
      return await work;
    } finally {
      if (--pending === 0) clearInterval(keepAlive);
    }
  }

  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    stayAwake(handle(msg)).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true; // keep the channel open for the async response
  });

  async function handle(msg: Message): Promise<unknown> {
    switch (msg.type) {
      case 'classify': {
        const settings = await getSettings();
        if (!settings.apiKey) return { ok: false, error: 'No OpenRouter API key set' } satisfies ClassifyResponse;
        const categorySignature = settings.categories
          .filter((c) => msg.inspect || c.enabled)
          .map((c) => `${c.id}:${c.description}:${c.enabled}`)
          .join('|');
        const id = `${msg.video.videoId}:${msg.video.details === undefined ? 'bare' : 'full'}:${msg.inspect ? 'inspect' : 'normal'}:${settings.model}:${settings.matchMethod}:${categorySignature}`;
        let p = inflight.get(id);
        if (!p) {
          p = classify(msg.video, settings, msg.inspect).finally(() => inflight.delete(id));
          inflight.set(id, p);
        }
        const scores = await p;
        if (!scores) return { ok: true, needDetails: true } satisfies ClassifyResponse;
        return { ok: true, scores } satisfies ClassifyResponse;
      }
      case 'testKey': {
        const r = await systemOne(
          msg.apiKey,
          {
            model: msg.model,
            state: { title: 'Try Not To Laugh Challenge #47 | Funniest Fails Compilation', channel: 'LOL Daily' },
            questions: { comedy: { type: 'noul', instructions: 'Is this video primarily comedy or humor content?' } },
          },
          { retries: 0 },
        );
        return { ok: true, noul: r.answers.comedy?.noul ?? NaN, model: r.model } satisfies TestKeyResponse;
      }
      case 'countScanned':
        await bumpStats({ scanned: 1 });
        return { ok: true };
      case 'countMatch':
        await bumpStats({ matched: 1 });
        return { ok: true };
      case 'countActioned':
        await bumpStats({ actioned: 1 });
        return { ok: true };
      case 'clearCache':
        return { ok: true, removed: await clearCache() };
    }
  }
});
