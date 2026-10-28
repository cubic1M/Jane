import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { FeesBody } from "./body";

export default function FeesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <FeesBody />
      </Suspense>
    </main>
  );
}
