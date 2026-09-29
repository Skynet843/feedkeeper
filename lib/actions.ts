import { extractVideo, menuButtonOf } from './extract';
import { NOT_INTERESTED_LABELS, SEL } from './selectors';

export type ActionResult = 'done' | 'unconfirmed' | 'menu-busy' | 'no-button' | 'no-menu' | 'no-item';

/**
 * Opens the tile's ⋮ menu and clicks "Not interested".
 * Clicks are programmatic, so the page never scrolls under the user.
 */
export async function clickNotInterested(tile: Element): Promise<ActionResult> {
  // Don't fight the user: if they have a menu open, try again later.
  if (visibleMenuItems().length > 0) return 'menu-busy';

  const button = menuButtonOf(tile);
  if (!button) return 'no-button';
  const videoId = extractVideo(tile)?.videoId;
  button.click();

  const items = await waitFor(() => {
    const found = visibleMenuItems();
    return found.length > 0 ? found : null;
  }, 3000);
  if (!items) return 'no-menu';

  const target = items.find((i) => {
    const t = i.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
    return NOT_INTERESTED_LABELS.some((label) => t === label || t.startsWith(label));
  });
  if (!target) {
    closeMenu();
    return 'no-item';
  }
  (target.querySelector<HTMLElement>(SEL.menuItemButton) ?? (target as HTMLElement)).click();

  // YouTube swaps the tile (or its content) for a "Video removed · Undo" notice.
  const confirmed = await waitFor(() => (!tile.isConnected || extractVideo(tile)?.videoId !== videoId ? true : null), 3000);
  if (!confirmed) closeMenu();
  return confirmed ? 'done' : 'unconfirmed';
}

function visibleMenuItems(): Element[] {
  return [...document.querySelectorAll(`${SEL.openMenu} ${SEL.menuItem}`)].filter(
    (el) => (el as HTMLElement).getClientRects().length > 0,
  );
}

function closeMenu(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

async function waitFor<T>(check: () => T | null, timeoutMs: number, stepMs = 100): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return null;
}
