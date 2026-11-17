import { AppHeaderLoading } from "@/components/app-header";

// Home while it loads, on a slow phone for seconds (mobile pass 11-16: at 1.5 s a blank page under
// the header, no sign anything was coming): the first screen's shape in plain blocks, no words.
// The net worth card with its chart's room (190 px on a phone, 260 wider, as the chart itself),
// then Safe to spend and Money found. It is still the page's loading bar to the code and tests
// that wait for one (data-loading-bar), and says so to a screen reader.
const BLOCK = "bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800";
const CARD = "flex flex-col gap-3 border border-zinc-300 p-4 dark:border-zinc-700";

export function HomeLoading() {
  return (
    <>
      <AppHeaderLoading />
      <div
        role="progressbar"
        aria-label="Loading your hub"
        data-loading-bar=""
        data-home-loading=""
        className="flex flex-col gap-6"
      >
        <div className={CARD}>
          <div className={`h-4 w-24 ${BLOCK}`} />
          <div className={`h-12 w-48 ${BLOCK}`} />
          <div className={`h-[190px] w-full sm:h-[260px] ${BLOCK}`} />
        </div>
        <div className={CARD}>
          <div className={`h-4 w-28 ${BLOCK}`} />
          <div className={`h-9 w-40 ${BLOCK}`} />
        </div>
        <div className={CARD}>
          <div className={`h-4 w-24 ${BLOCK}`} />
          <div className={`h-8 w-36 ${BLOCK}`} />
        </div>
      </div>
    </>
  );
}
