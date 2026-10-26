import Link from "next/link";
import type { ComponentProps } from "react";
import { isHiddenPage } from "@/config/hidden-pages";

// A link that isn't drawn when its page is hidden in the read-only beta
// (src/config/hidden-pages.ts): the page comes back, and so does the link, when its line goes.
export function ShownLink(props: ComponentProps<typeof Link>) {
  const href = typeof props.href === "string" ? props.href : (props.href.pathname ?? "");
  if (isHiddenPage(href)) return null;
  return <Link {...props} />;
}
