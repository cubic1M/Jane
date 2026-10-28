import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { ValuesBody } from "./body";

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/values">["searchParams"];
}) {
  const { done } = await searchParams;
  return <ValuesBody done={done} />;
}

export default function ValuesPage(props: PageProps<"/investments/values">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
