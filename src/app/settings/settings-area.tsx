"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { AreaPage } from "@/components/area-page/area-page";

// Settings' area page, plus its old section anchors: emails, Jane's messages and other pages
// link to /settings#alerts, #two-factor and the like. The server never sees the hash, so once
// the page is up, an anchor it knows opens that item, as ?focus= would.
export function SettingsArea({
  anchors,
  ...page
}: ComponentProps<typeof AreaPage> & { anchors: Record<string, string> }) {
  const [focus, setFocus] = useState(page.focus);

  useEffect(() => {
    if (page.focus) return;
    const to = anchors[window.location.hash.slice(1)];
    // Opening it means mounting the tree afresh with that focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (to) setFocus(to);
  }, [anchors, page.focus]);

  return <AreaPage key={focus ?? ""} {...page} focus={focus} />;
}
