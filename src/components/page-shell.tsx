import { Suspense, type ReactNode } from "react";
import { PageLoading } from "@/components/app-header";

// The frame most pages share: a centred column, and the loading bar while the page's data comes.
// The class lists stay whole words here, so Tailwind finds them.
const LAYOUTS = {
  normal: "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12",
  roomy: "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12",
  widest: "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8",
} as const;

export function PageShell({
  layout = "normal",
  label,
  children,
}: {
  layout?: keyof typeof LAYOUTS;
  label?: string;
  children: ReactNode;
}) {
  return (
    <main className={LAYOUTS[layout]}>
      <Suspense fallback={<PageLoading label={label} />}>{children}</Suspense>
    </main>
  );
}
