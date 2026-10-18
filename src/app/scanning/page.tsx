import { Suspense } from "react";
import { ScanningProgress } from "./scanning-progress";
import { requireUser } from "@/lib/session";

async function SignedInProgress() {
  await requireUser();
  return <ScanningProgress />;
}

export default function ScanningPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Scanning your money</h1>
      <Suspense>
        <SignedInProgress />
      </Suspense>
    </main>
  );
}
