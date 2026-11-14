import { robinhoodOffered } from "@/config/robinhood";
import { momentTimeLabel } from "@/lib/moment-time";
import { connectionView, whyCantConnect } from "@/lib/robinhood/connection";
import { timezoneOf } from "@/lib/today";

// The Robinhood box on the Investing page: off, nothing at all, not even a query. Before connecting,
// it says in plain words what connecting does. Robinhood has one permission, which also lets a
// connection trade in an agent account if the person opens one, so that gets said too. A link and a
// form, with no script of its own, since /investments is at its size budget.

const NOTICES: Record<string, string> = {
  connected: "Robinhood is connected.",
  not_connected: "Robinhood wasn't connected. You can try again.",
  paused: "Connecting is paused for now. Please try again later.",
  disconnected:
    "Disconnected. Jane deleted its access and what it read. Robinhood gives Jane no way to end the connection on its side, so ask Robinhood if you want it removed there too.",
};

// The address bar is anyone's to write, so a link can't say it's connected or gone when it isn't.
const trueNow = (notice: string, connected: boolean) =>
  notice === "connected" ? connected : notice === "disconnected" ? !connected : true;

const BUTTON =
  "w-fit cursor-pointer border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

// A plain link, so nothing runs until they choose it. The route answers with Robinhood's page.
function ConnectLink({ label }: { label: string }) {
  return (
    <a href="/api/robinhood/connect" className={BUTTON}>
      {label}
    </a>
  );
}

function DisconnectForm() {
  return (
    <details className="flex flex-col gap-2" data-robinhood-disconnect="">
      <summary className={BUTTON}>Disconnect</summary>
      <form action="/api/robinhood/disconnect" method="post" className="mt-2 flex flex-col gap-2">
        <p className="text-sm">This deletes what Jane read from Robinhood.</p>
        <button type="submit" className={BUTTON}>
          Yes, disconnect
        </button>
      </form>
    </details>
  );
}

export async function RobinhoodPanel({
  userId,
  notice,
}: {
  userId: string;
  notice: string | undefined;
}) {
  if (!robinhoodOffered()) return null;
  const [view, timezone] = await Promise.all([connectionView(userId), timezoneOf(userId)]);
  // When Jane last read it, in the person's own time (momentTimeLabel), not UTC.
  const stamp = (date: Date) => momentTimeLabel(date, timezone);
  // Someone refused a new connection who already has one can still end it.
  if (view === null && (await whyCantConnect(userId))) return null;
  const said =
    notice && Object.hasOwn(NOTICES, notice) && trueNow(notice, view !== null)
      ? NOTICES[notice]
      : null;
  return (
    <section
      data-robinhood=""
      aria-labelledby="robinhood-heading"
      className="flex flex-col gap-3 border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="robinhood-heading" className="text-lg font-semibold">
        Robinhood
      </h2>
      {said && <p role="status">{said}</p>}
      {view === null && (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>You sign in on Robinhood&apos;s own page. Jane never sees your password.</li>
            <li>
              Jane only reads your accounts, balances, holdings and orders. It can&apos;t trade.
            </li>
            <li>
              Robinhood&apos;s connection itself can trade if you open its agent account. Jane
              doesn&apos;t need one, so don&apos;t open it for Jane.
            </li>
          </ul>
          <ConnectLink label="Connect Robinhood" />
        </>
      )}
      {view?.status === "active" && (
        <>
          <p className="text-sm">
            <span className="font-medium">Connected.</span>{" "}
            {view.lastUpdated ? `Last updated ${stamp(view.lastUpdated)}.` : "Not read yet."}{" "}
            {view.failing && "The last read didn't work; Jane will try again."}
          </p>
          <DisconnectForm />
        </>
      )}
      {view?.status === "reconnect" && (
        <>
          <p className="text-sm">
            <span className="font-medium">Robinhood stopped accepting this connection.</span> The
            numbers here are from {view.lastUpdated ? stamp(view.lastUpdated) : "before it stopped"}
            .
          </p>
          <ConnectLink label="Reconnect Robinhood" />
          <DisconnectForm />
        </>
      )}
      {view && view.twins.length > 0 && (
        <p className="text-sm">
          {view.twins.join(", ")} also counts in your totals, so Robinhood may be counted twice. You
          can remove it in Settings.
        </p>
      )}
    </section>
  );
}
