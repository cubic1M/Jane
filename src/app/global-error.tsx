"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";

// When even the frame of every page (the root layout) breaks: its own html and body, so the
// screen is never blank.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-full flex-col">
        <ErrorScreen
          title="Something went wrong"
          words="Jane hit a problem loading this page. Your data is safe. Try again in a moment."
          from="/"
          retry={
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center rounded-full border border-zinc-900 px-5 font-semibold"
            >
              Try again
            </button>
          }
        />
      </body>
    </html>
  );
}
