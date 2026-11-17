"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

// Home opened by a link while it loads starts at the top (debug 3, 11-17: after an upload, "Go to
// Home" from 792 px down /import opened Home 792 px down, the upload notice off screen, 3 taps in 6).
// The skeleton is short, so the page stops a little down (46 px: the upload notice's room) rather
// than at 0; the router leaves it there because Home's top is on screen, and when Home's content
// takes the skeleton's place the browser keeps whatever it then anchors on still, which carries the
// page down. At 0 neither happens. Not on a page load (the browser puts a reloaded page back).
const noChange = () => () => {};

export function ArriveAtTop() {
  const loadedWithPage = useSyncExternalStore(
    noChange,
    () => false,
    () => true,
  );
  const first = useRef(loadedWithPage);
  useLayoutEffect(() => {
    if (!first.current && window.scrollY > 0) window.scrollTo(0, 0);
  }, []);
  return null;
}
