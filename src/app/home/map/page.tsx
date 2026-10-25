import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { FeatureTree } from "@/components/feature-tree";
import { AREA_KEYS, type AreaKey } from "@/config/areas";
import { adviceMode } from "@/lib/advice-mode";
import { scopedFor } from "@/lib/db-scoped";
import { buildFeatureMap, sampleExamples } from "@/lib/feature-map";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";

// "What Jane does" (docs/design/home-hub.md), from the hub: each area's features as a tree,
// generated from the detectors (src/lib/feature-map.ts), with what has reached this person
// marked "for you". ?area= opens on one area.

async function MapContent({
  searchParams,
}: {
  searchParams: PageProps<"/home/map">["searchParams"];
}) {
  await connection();
  const user = await requireUser();
  const asked = (await searchParams).area;
  const initial: AreaKey = AREA_KEYS.includes(asked as AreaKey) ? (asked as AreaKey) : "money";
  const [reached, advice] = await Promise.all([
    scopedFor(user.id).suggestions.findMany({ select: { key: true } }),
    adviceMode(user.id),
  ]);
  const maps = buildFeatureMap({
    examples: sampleExamples(),
    reached: new Set(reached.map((r) => r.key)),
    advice,
  });
  const total = maps.reduce((n, m) => n + m.features, 0);
  const mine = maps.reduce((n, m) => n + m.forYou, 0);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">What Jane does</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {total} things Jane looks for, {mine} of them for you so far.{" "}
          <Link href="/home" className="font-medium text-emerald-700 hover:underline">
            Back to Home
          </Link>
        </p>
      </div>
      {advice && <DemoAdviceLabel />}
      <FeatureTree maps={maps} initial={initial} />
    </>
  );
}

export default function FeatureMapPage({ searchParams }: PageProps<"/home/map">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<LoadingBar label="Loading the map" />}>
        <MapContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
