// Every YouTube DOM selector lives here. YouTube ships markup changes often; when the
// extension stops finding tiles or menus, this is the file to update.
// Verified against the home feed and watch-page sidebar on 2026-09-27 (yt-lockup-view-model layout).

export const SEL = {
  /** Home page only: the browse element for the home feed. */
  homeBrowse: 'ytd-browse[page-subtype="home"]',

  /** One grid cell in the home feed (regular videos and Shorts shelf items). */
  tile: 'ytd-rich-item-renderer',
  /** Watch page: the "Up next" recommendations column (moves below the player on narrow windows). */
  watchSidebar: 'ytd-watch-next-secondary-results-renderer',
  /** One recommendation in the sidebar; unlike the home feed, the lockup itself is the tile. */
  sidebarTile: 'yt-lockup-view-model, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2',

  /** Sponsored cells; never classified or actioned. */
  ad: 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer',

  // Regular video lockup
  lockup: 'yt-lockup-view-model',
  lockupHost: '.ytLockupViewModelHost',
  lockupThumb: 'a.ytLockupViewModelContentImage',
  lockupTitle: '.ytLockupMetadataViewModelTitle',
  lockupChannelLink: '.ytContentMetadataViewModelMetadataRow a',
  lockupAvatar: '[aria-label^="Go to channel"]',
  lockupMetaRow: '.ytContentMetadataViewModelMetadataRow',
  lockupDuration: 'yt-thumbnail-badge-view-model',
  lockupMenuButton: '.ytLockupMetadataViewModelMenuButton button',
  /** Title + channel column; retained for layout compatibility checks. */
  lockupTextContainer: '.ytLockupMetadataViewModelTextContainer',

  // Shorts lockup
  shorts: 'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2',
  shortsLink: 'a[href^="/shorts/"]',
  shortsTitle: '.shortsLockupViewModelHostMetadataTitle',
  shortsThumb: '.shortsLockupViewModelHostThumbnailParentContainer',
  shortsMenuButton: '.shortsLockupViewModelHostOutsideMetadataMenu button',
  shortsMetadata: '.shortsLockupViewModelHostOutsideMetadata',

  // Block Shorts hides these on every YouTube page.
  /** Shorts shelves: home/subscriptions (with the heading), watch sidebar, and search results (grid-shelf verified 2026-09-28). */
  shortsShelf:
    'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), ytd-reel-shelf-renderer, grid-shelf-view-model:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)',
  /** A Short outside a shelf; the home grid cell goes too so no empty slot is left. */
  shortsItem:
    'ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2), ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-video-renderer:has(a[href^="/shorts/"])',
  /** Left-nav Shorts entry. The expanded guide's link has no href, so its title (untranslated in most locales) is the hook. */
  shortsNav: ':is(ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer):has(a[href="/shorts/"], a[title="Shorts"])',

  // Popup menu opened by the ⋮ button
  openMenu: 'ytd-popup-container tp-yt-iron-dropdown:not([aria-hidden="true"])',
  menuItem: 'yt-list-item-view-model, ytd-menu-service-item-renderer',
  menuItemButton: 'button[role="menuitem"], tp-yt-paper-item',
} as const;

/** "Not interested" in the languages we've seen; matched case-insensitively against the menu item text. */
export const NOT_INTERESTED_LABELS = [
  'not interested',
  'no me interesa',
  'pas intéressé',
  'kein interesse',
  'non mi interessa',
  'não tenho interesse',
  'не интересует',
  'दिलचस्पी नहीं है',
  'रुचि नहीं है',
  '興味なし',
  '관심 없음',
  '不感兴趣',
  '不感興趣',
  'ilgilenmiyorum',
  'niet geïnteresseerd',
  'tidak tertarik',
];
