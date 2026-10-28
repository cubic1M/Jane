import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { ShortTermBody } from "./body";

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/short-term">["searchParams"];
}) {
  const { done } = await searchParams;
  return <ShortTermBody done={done} />;
}

export default function ShortTermPage(props: PageProps<"/investments/short-term">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
