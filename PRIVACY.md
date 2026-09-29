# Privacy

FeedKeeper has no server, no analytics and no tracking. Here is everything that leaves your browser.

| Data | Sent to | When |
| ---- | ------- | ---- |
| Video title, channel name, duration, and (unless turned off) the description, chapters, tags and YouTube category | `openrouter.ai` (TypeSafe Jev), with **your** API key | Once for each video that isn't cached yet |
| Video ID | `youtube.com` (the same player endpoint YouTube's own page calls) | To fetch the description; turn this off in Settings |
| "Not interested" clicks | `youtube.com`, as normal clicks on your account | **Auto remove** mode only |

Nothing about *you* is sent to OpenRouter: no watch history, no account name, no cookies.
[OpenRouter's privacy policy](https://openrouter.ai/privacy) covers what happens to requests there.

Stored locally in `chrome.storage.local`:

- your settings and API key
- per-video scores and descriptions, deleted after 14 days (**Clear cached scores** in Settings deletes them now)
- daily counters (scanned, matched, removed, cost)
- if enabled, the latest 200 filter decisions (video ID, title, channel, reason and time); clear them in Settings

Uninstalling the extension deletes all of it.
