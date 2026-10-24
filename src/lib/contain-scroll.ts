// The chat never scrolls the page around it (founder: "Never let the chat scroll affect the
// whole screen scroll"). overscroll-behavior: contain (src/app/globals.css) covers a chat that
// can scroll; a scroll the chat can't take any further (at its end, or when it's too short to
// scroll at all) the browser still hands to the page, so it is stopped here instead.

export type Scroller = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  overflowY: string;
};

// Whether this box can still move by `deltaY` (down is positive).
export function canScroll(box: Scroller, deltaY: number): boolean {
  const scrolls = box.scrollHeight > box.clientHeight + 1;
  if (!scrolls || deltaY === 0) return false;
  if (deltaY > 0) return box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  return box.scrollTop > 0;
}

// From the element under the pointer up to the page: does anything on the way take the scroll?
export function takesScroll(path: readonly Scroller[], deltaY: number): boolean {
  return path.some(
    (box) => (box.overflowY === "auto" || box.overflowY === "scroll") && canScroll(box, deltaY),
  );
}

function pathOf(target: EventTarget | null, doc: Document): Scroller[] {
  const out: Scroller[] = [];
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el === doc.documentElement || el === doc.body) break;
    const { overflowY } = getComputedStyle(el);
    out.push({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY,
    });
  }
  const page = doc.scrollingElement ?? doc.documentElement;
  out.push({
    scrollTop: page.scrollTop,
    scrollHeight: page.scrollHeight,
    clientHeight: page.clientHeight,
    overflowY: "auto",
  });
  return out;
}

// Stops a wheel or a finger that nothing in this document can take any further.
export function containScroll(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // a pinch on a trackpad zooms
    if (!takesScroll(pathOf(event.target, doc), event.deltaY)) event.preventDefault();
  };
  let lastY: number | null = null;
  const onTouchStart = (event: TouchEvent) => {
    lastY = event.touches.length === 1 ? event.touches[0].clientY : null;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (lastY === null || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const deltaY = lastY - y;
    lastY = y;
    if (deltaY !== 0 && !takesScroll(pathOf(event.target, doc), deltaY) && event.cancelable) {
      event.preventDefault();
    }
  };
  win.addEventListener("wheel", onWheel, { passive: false });
  win.addEventListener("touchstart", onTouchStart, { passive: true });
  win.addEventListener("touchmove", onTouchMove, { passive: false });
  return () => {
    win.removeEventListener("wheel", onWheel);
    win.removeEventListener("touchstart", onTouchStart);
    win.removeEventListener("touchmove", onTouchMove);
  };
}
