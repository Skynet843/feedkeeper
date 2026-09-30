# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-09-30

Compared with 1.0.0 on 293 labelled videos, scans decide 1046 of 1059 filter decisions correctly instead of 1034,
and cost about half as much: 879 input tokens per video instead of 1648 with the default three categories
(about $0.037 instead of $0.069 per 1,000 videos). Shorts are no longer sent to the AI at all.

### Added

- **Corrections:** with history on, choosing **Always show video** or **Always hide video** under **Why?** saves the
  video with the filter it was judged under. Settings can export them, and `pnpm eval --corrections <file>` replays
  them to check definition changes against your own corrections.
- 128 more labelled eval videos (`holdout4`, `holdout5`): Hindi and Hinglish titles, overlap-heavy cases and the
  thinner categories, plus a scenario for the default Comedy, Vlogs and Challenges selection.

### Changed

- With combined matching and two or more selected categories, a scan asks Jev only the combined question instead
  of that question plus one per selected category. Requests are about half the size with the default three
  categories and about 40% with nine. The badge no longer names the top matching categories until you choose
  **Why?**.
- Shorts are never classified. **Block Shorts** hides them for free; with it off they are shown unfiltered.
- Shorter question wording without the separate yes/no criteria, and no format field. **Why?** costs 27% fewer
  tokens. Cached scores are asked again once, because the question version changed.
- Tighter definitions: Challenges covers creator-versus-creator contests, timed survival stays and philanthropy
  stunts; Vlogs covers ASMR, roleplay and what-I-eat-in-a-day videos; Drama covers celebrity controversy roundups;
  Music covers music production. Lifestyle, Health, Podcasts and News exclude eating challenges, routine vlogs, TV
  debates and campaign speeches. Unwanted videos shown drop from 22 to 8 and **Why?** false matches from 11 to 0;
  wanted videos hidden rise from 3 to 5, all borderline (57–74%) in **Only show selected**.

### Fixed

- The daily cost counter showed $0 when a TypeSafe key is attached to OpenRouter (BYOK), because OpenRouter reports
  those requests as free. A reported $0 for a request that used tokens now falls back to the token estimate.

## [1.0.0] - 2026-09-29

First release of this repository. It includes everything from the earlier development versions listed below.

### Highlights

- Classifies home-feed videos and watch-page "Up next" recommendations with TypeSafe Jev through OpenRouter, using
  the description, chapters, tags and YouTube category as well as the title.
- Three modes: **Preview** (outline and decision badge), **Hide** (blur with a Show button) and **Auto remove**
  (paced *⋮ → Not interested* clicks, capped per minute and per page).
- **Block Shorts**: one switch hides every Short on YouTube, with no AI calls and no cost.
- 21 built-in categories in four groups, plus custom categories with your own definition.
- Block-selected and allow-only directions, combined scoring, per-video **Why?** inspection, corrections, channel
  blocklists and free local title rules.
- Filter profiles, focus sessions, per-surface controls and an optional local decision history.
- A demo video and gallery in the README.

## [0.3.0] - 2026-09-29

### Added

- **Block Shorts**: one switch in the popup (and Settings) hides every Short on YouTube: home, subscriptions,
  watch-page and search shelves, single Shorts tiles, and the Shorts menu entry. Hidden Shorts are never classified.

### Fixed

- Tiles no longer fail with "message channel closed before a response was received" when slow or rate-limited Jev
  calls let Chrome stop the background worker: it now stays awake while requests are pending, and the page retries
  once if the worker was stopped anyway.

### Changed

- README refresh: a demo video on YouTube and a gallery of the popup, Preview, Hide, Auto remove and Block Shorts,
  replacing the old screenshots and demo capture.

## [0.2.0] - 2026-09-28

### Added

- Block-selected and allow-only filter directions, with allow-only safely limited to Preview and Hide behavior.
- Combined selected-category scoring so confidence split across overlapping categories can cross the threshold.
- Per-video **Why?** inspection that fetches and caches the full category distribution only on demand.
- Video/channel corrections, a channel blocklist, free local title rules, and optional borderline dimming/hiding.
- Independent home/sidebar controls, reusable filter profiles, temporary focus sessions, and local decision history.
- A branded README hero, browser-support matrix, community links, and early-release guidance.
- Architecture and support guides covering runtime flow, trust boundaries, permissions, and issue routing.
- Weekly Dependabot checks for pnpm dependencies.
- `pnpm eval`: an accuracy check on 165 real, hand-labelled YouTube videos (84 for tuning, 81 held out) covering
  every category and its boundaries, reporting per-selection decisions, per-category precision/recall and a
  threshold sweep.

### Fixed

- Auto remove no longer sends "Not interested" for borderline videos set to Hide; only confident matches are reported.
- Ending a focus session restores the mode an allow-only profile switched away from, instead of leaving Hide on.
- Combined matching can no longer veto a clear single-category match; it only adds matches.
- The borderline setting (show, dim, hide) now applies in allow-only mode too.
- Title rules match whole words, so a rule for "ai" no longer hides "rain" or "said".
- Toggling several categories re-scores the feed once, after a short pause, instead of once per click.

### Changed

- Refined all 19 built-in category boundaries to distinguish engineering/maker projects from vlogs, household DIY, shopping and incidental humor. Revised the combined question to respect exclusions and avoid encouraging inflated confidence; old question scores are invalidated automatically.
- Replaced the all-category Preview score line with compact decision badges and on-demand inspection.
- Narrowed exclusions that the eval showed were hiding real matches: household repair how-tos count as lifestyle,
  teardowns and durability tests as gadgets, game graphics and trailer analysis as gaming, film VFX breakdowns and
  reactions as movies, children's educational shows as kids, and spectacle builds and makeovers as entertainment.
- Reorganised the built-in categories from 19 to 21, checked against held-out videos:
  - *Entertainment & vlogs* is now *Vlogs & daily life*, *Challenges, pranks & stunts* and *Reactions & pop culture*,
    each defined by what it is rather than by exclusions.
  - *News & politics* is now *News & current affairs* and *Politics & opinion*, so political commentary, debates and
    rallies can be blocked while news reports stay visible. Both sit in a new Current affairs group.
  - Learning categories sit under Learning & growth, and Religion & spirituality moved to Lifestyle.
  - Children's TV counts as Kids content rather than Movies, TV & anime; skill lessons such as languages, design,
    filmmaking and writing count as Science & education; a performance on a self-built instrument counts as music.
  - Existing selections, profiles and focus sessions carry over: selecting a split category selects all of its
    parts, and an edited definition of a retired category is kept as a custom category.
- Security documentation now describes the API-key boundary precisely.
- Refined the popup and YouTube overlays with clearer hierarchy, polished controls, and an upgraded visual system.
- Replaced the README banner and popup preview with sharper high-resolution artwork.
- Replaced the staged feed image with a retina capture from a working Chrome session and added an HD reveal/hide demo.

## [0.1.0] - 2026-09-27

First public release.

### Added

- Classifies home-feed videos and watch-page "Up next" recommendations with TypeSafe Jev through OpenRouter.
- Three modes: **Preview** (outline and scores), **Hide** (blur, with a Show button), and **Auto remove** (clicks
  ⋮ → Not interested, paced and capped).
- 19 built-in categories in 3 groups, plus custom categories with your own definition.
- Uses the video description, chapters, tags and YouTube category, not only the title.
- A score line under each video, a sensitivity slider, a channel allowlist, and daily stats with cost.
- A 14-day per-video cache, so reloading the feed costs nothing.
