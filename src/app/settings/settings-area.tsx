"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { AreaPage } from "@/components/area-page/area-page";

// Settings' area page, plus its old section anchors: emails, Jane's messages and other pages
// link to /settings#alerts, #two-factor and the like. The server never sees the hash, so once
// the page is up (or the hash changes while it's open), an anchor it knows opens that item, as
// ?focus= would.
export function SettingsArea({
  anchors,
  ...page
}: ComponentProps<typeof AreaPage> & { anchors: Record<string, string> }) {
  const [focus, setFocus] = useState(page.focus);

  useEffect(() => {
    const open = () => {
      const to = anchors[window.location.hash.slice(1)];
      if (to) setFocus(to);
    };
    if (!page.focus) open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [anchors, page.focus]);

  // A new focus mounts the tree afresh, opened there.
  return <AreaPage key={focus ?? ""} {...page} focus={focus} />;
}
