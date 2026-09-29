# Security Policy

FeedKeeper handles one secret: your OpenRouter API key. It is stored in `chrome.storage.local` and sent only to
`https://openrouter.ai`. Classification requests are made by the extension's background service worker. The
YouTube page cannot access extension storage or the key; FeedKeeper never writes the key into the page DOM,
page scripts, logs, or network requests to YouTube.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/Skynet843/feedkeeper/security/advisories/new) instead.
Include the steps to reproduce and the version (`manifest.json` → `version`).

You should get a reply within a week. Fixes ship in a new release, and the advisory is published afterwards.

## In scope

- Anything that leaks the API key to a web page, another extension, logs or any host other than openrouter.ai
- Anything that lets a web page make the extension click, hide or fetch things it shouldn't
- Anything that sends YouTube data to a host other than openrouter.ai
