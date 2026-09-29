import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'output',
  manifest: {
    name: 'FeedKeeper',
    description: 'Your YouTube feed, on your terms. Removes the kinds of videos you choose from your home feed and recommendations, using TypeSafe Jev.',
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['https://openrouter.ai/*'],
  },
});
