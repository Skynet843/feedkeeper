# Contributing to FeedKeeper

Thanks for helping. Bug reports, selector fixes, new categories and docs are all welcome.

## Setup

You need Node 22+ and pnpm 9+.

```sh
git clone https://github.com/Skynet843/feedkeeper.git
cd feedkeeper
pnpm install
pnpm dev        # opens Chrome with the extension loaded and hot reload
```

`pnpm dev` starts a fresh Chrome profile. To test with your own YouTube account, run `pnpm build` instead and
load `output/chrome-mv3` with **Load unpacked** in `chrome://extensions`. Click ↻ on the extension after every
build.

Before opening a PR:

```sh
pnpm compile    # type-check
pnpm build      # must succeed
```

## YouTube changed its layout and nothing works

This is the most common breakage and the easiest fix to contribute. Every YouTube selector lives in
[`lib/selectors.ts`](lib/selectors.ts). Open DevTools on youtube.com and find the new element names:

- a home-feed tile (`ytd-rich-item-renderer` today)
- the sidebar tile on a watch page (`yt-lockup-view-model`)
- the ⋮ menu button and its **Not interested** item

Update the selectors, then check both the home feed and a watch page in **Preview** mode. Every normal video should
get a **Why?** control, and matching videos should get a decision badge. Please add the date you checked to the
comment at the top of the file.

If YouTube shows **Not interested** in a language that isn't listed, add its label to `NOT_INTERESTED_LABELS`.

## Checking classification quality

`scripts/category-cases.json` holds real YouTube videos with frozen metadata (exactly what Jev sees) and
hand-assigned labels: `labels` clearly apply, `maybe` are defensible either way and are not scored. Put
`OPENROUTER_API_KEY=sk-or-...` in a `.env` file (gitignored), then:

```sh
pnpm eval --dry-run                  # build every request, no API calls
pnpm eval                            # paid: ~660 requests, about $0.08; answers saved to output/category-eval.json
pnpm eval --from output/category-eval.json --threshold 0.8   # re-score saved answers for free
```

It reports decisions for three selections (block distractions, block news & drama, only show learning),
per-category precision and recall, and a threshold sweep. Add a case with just `videoId`, `labels` and `maybe`,
then run `pnpm eval --fetch` to freeze its metadata. Compare definition versions with `--defs` and `--request`
pointing at copies exported from git.

Each case has a `split`. Write definition changes against `dev` cases only, then check them with
`pnpm eval --split holdout` (and `holdout2`, `holdout3`). Once a held-out set's failures have prompted an edit, it
no longer tells you whether that edit generalizes: label a fresh set for the boundary before scoring it, and give it
a new split name.

`scripts/jev-spike.mjs` sends Jev the same request the extension sends, so you can tune category definitions
from the terminal:

```sh
OPENROUTER_API_KEY=sk-or-... pnpm spike                       # built-in sample titles
OPENROUTER_API_KEY=sk-or-... pnpm spike --video dQw4w9WgXcQ   # real videos, prints what Jev saw
```

If you change a built-in category's description in `lib/categories.ts`, include the before/after `pnpm eval`
summary in the PR.

## Pull requests

- Keep PRs focused. One fix or feature per PR.
- Match the style of the surrounding code. TypeScript is strict, and there are no runtime dependencies.
- Never log, render, or send the user's API key anywhere except `openrouter.ai`. Classification requests belong
  in the background service worker, and the YouTube page must never receive the key.
- Anything that clicks on YouTube must keep going through the paced queue in `lib/queue.ts`.
- Describe what you tested: home feed, watch sidebar, and which modes.

For a deeper map of the runtime, storage model, and trust boundaries, read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Code of conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
