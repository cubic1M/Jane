"use client";

import { lazy, Suspense, type ComponentProps } from "react";

// The first scan's bar, in a chunk of its own: every signed-in page's header can draw it, and
// almost no page view does.
const Bar = lazy(() => import("./scan-bar").then((bar) => ({ default: bar.ScanBar })));

export function ScanBarLazy(props: ComponentProps<typeof Bar>) {
  return (
    <Suspense>
      <Bar {...props} />
    </Suspense>
  );
}
