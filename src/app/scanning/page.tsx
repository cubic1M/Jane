import { Suspense } from "react";
import { ScanningProgress } from "./scanning-progress";
import { requireUser } from "@/lib/session";

// Where to go once the scan is done: the report, or Home with Jane's chat beside it (?then=home,
// after linking the demo bank, spec step 82; ?then=chat from older links).
async function SignedInProgress({
  searchParams,
}: {
  searchParams: PageProps<"/scanning">["searchParams"];
}) {
  await requireUser();
  const { then } = await searchParams;
  return <ScanningProgress next={then === "home" || then === "chat" ? "/home" : "/report"} />;
}

export default function ScanningPage({ searchParams }: PageProps<"/scanning">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Scanning your money</h1>
      <Suspense>
        <SignedInProgress searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
