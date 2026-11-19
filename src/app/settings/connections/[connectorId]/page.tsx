import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { SubmitButton } from "@/components/submit-button";
import { connectorsOn } from "@/config/connectors";
import { connectScreen, safeReturnPath, type ConnectScreen } from "@/lib/connectors/connect";
import { ConsentError } from "@/lib/connectors/consent";
import { requireUser } from "@/lib/session";
import { connectNow, notNow } from "./actions";

// The consent screen every connector uses (src/lib/connectors/connect.ts): what Jane reads, from whom,
// and how to stop, then a yes or a "Not now". A 404 unless CONNECTORS=1.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const BUTTON =
  "relative h-11 rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";

function Screen({ screen, from }: { screen: ConnectScreen; from: string }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-semibold tracking-tight">{screen.name}</h1>
      <section aria-labelledby="reads" className="flex flex-col gap-1">
        <h2 id="reads" className="font-semibold">
          What Jane gets
        </h2>
        <ul className="list-disc pl-5 text-sm">
          {screen.reads.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="from" className="flex flex-col gap-1">
        <h2 id="from" className="font-semibold">
          From
        </h2>
        <p className="text-sm">{screen.from}</p>
        {screen.partnerStep && (
          <p className={MUTED}>You sign in on their page, then come straight back here.</p>
        )}
      </section>
      <section aria-labelledby="stop" className="flex flex-col gap-1">
        <h2 id="stop" className="font-semibold">
          How to stop
        </h2>
        <p className="text-sm">
          Any time, in Settings › Connections: Revoke, and Jane stops at once.
        </p>
      </section>
      {screen.agreesTo === null ? (
        <p role="status" className="text-sm font-medium">
          This isn&apos;t ready yet: its wording still needs approving.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <form action={connectNow}>
            <input type="hidden" name="connectorId" value={screen.connectorId} />
            <input type="hidden" name="from" value={from} />
            <SubmitButton className={BUTTON}>Allow</SubmitButton>
          </form>
          <form action={notNow}>
            <input type="hidden" name="connectorId" value={screen.connectorId} />
            <input type="hidden" name="from" value={from} />
            <SubmitButton className={`relative inline-flex min-h-11 items-center text-sm ${LINK}`}>
              Not now
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

async function Content({ params, searchParams }: Props) {
  await connection();
  const user = await requireUser();
  const { connectorId } = await params;
  const from = safeReturnPath((await searchParams).from);
  let screen: ConnectScreen;
  try {
    screen = await connectScreen(user.id, connectorId);
  } catch (error) {
    if (error instanceof ConsentError) notFound();
    throw error;
  }
  return (
    <>
      <AppHeader user={user} />
      <Screen screen={screen} from={from} />
      <Link href={from} className={`self-start ${LINK}`}>
        Back
      </Link>
    </>
  );
}

type Props = {
  params: Promise<{ connectorId: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default function ConnectPage(props: Props) {
  if (!connectorsOn()) notFound();
  return (
    <PageShell label="Loading">
      <Content {...props} />
    </PageShell>
  );
}
