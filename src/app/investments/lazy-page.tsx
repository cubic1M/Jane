"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "next";
import { embedPage } from "./embed-actions";

// A sub-page opened in place, loaded only when its tree item is tapped; "Open the full page"
// keeps the link.
export function LazyPage({
  pageKey,
  href,
  label,
}: {
  pageKey: string;
  href: Route;
  label: string;
}) {
  const [body, setBody] = useState<ReactNode>(undefined);
  useEffect(() => {
    let current = true;
    embedPage(pageKey)
      .then((node) => current && setBody(node ?? null))
      .catch(() => current && setBody(null));
    return () => {
      current = false;
    };
  }, [pageKey]);
  return (
    <div className="flex flex-col gap-3">
      {body === undefined ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
          Loading…
        </p>
      ) : (
        body
      )}
      <Link href={href} className="text-sm font-medium text-emerald-700 hover:underline">
        Open the full page: {label}
      </Link>
    </div>
  );
}
