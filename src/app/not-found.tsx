"use client";

import { usePathname } from "next/navigation";
import { ErrorScreen } from "@/components/error-screen";

// A page that isn't there (a mistyped address, an old link, a finding that's gone).
export default function NotFound() {
  return (
    <ErrorScreen
      title="Page not found"
      words="There's nothing at this address. It may have moved, or the link may be old."
      from={usePathname() ?? "/"}
    />
  );
}
