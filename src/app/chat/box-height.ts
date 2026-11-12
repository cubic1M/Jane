// How tall the chat's message box is drawn (src/app/chat/composer.tsx): as tall as what's typed in
// it, at least one line, and at most BOX_MAX_SHARE of the screen that's showing (on a phone, what
// the keyboard leaves); past that it scrolls inside.

const BOX_MAX_SHARE = 0.4;
// One line of text with its padding: the box's own minimum (min-h-11).
export const BOX_MIN_PX = 44;

export function boxHeight(
  contentPx: number,
  viewportPx: number,
): { height: number; scrolls: boolean } {
  const most = Math.max(BOX_MIN_PX, Math.floor(viewportPx * BOX_MAX_SHARE));
  const height = Math.min(Math.max(contentPx, BOX_MIN_PX), most);
  return { height, scrolls: contentPx > most };
}
