import { SubmitButton } from "@/components/submit-button";
import { disconnectMailbox } from "./actions";

// One mailbox on /settings/mailboxes: its address, the line the page chose for what Jane is doing
// with it, and Disconnect behind a <details>, which is the confirmation. Words only: the page
// decides which line applies.

const LINK = "font-medium underline underline-offset-2 hover:no-underline";
const QUIET =
  "relative inline-flex min-h-11 w-fit items-center border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Google is asked to end the permission only while Jane still holds it: a mailbox Google stopped
// accepting, or one connected to another Jane account since, has nothing left to end.
const CONFIRM =
  "This deletes what Jane read from this mailbox and asks Google to end Jane's permission.";
const CONFIRM_NO_ACCESS = "This deletes what Jane read from this mailbox.";

export function MailboxItem({
  id,
  address,
  line,
  missed,
  hasAccess,
}: {
  id: string;
  address: string;
  line: string;
  missed: string | null;
  hasAccess: boolean;
}) {
  return (
    <li
      data-mailbox={id}
      className="flex flex-col gap-2 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800"
    >
      <span data-private className="font-medium [overflow-wrap:anywhere]">
        {address}
      </span>
      <p className="text-sm">{line}</p>
      {missed && <p className="text-sm">{missed}</p>}
      <details className="flex flex-col gap-2">
        <summary className={`cursor-pointer text-sm ${LINK}`}>
          Disconnect
          <span data-private className="sr-only">
            : {address}
          </span>
        </summary>
        <form action={disconnectMailbox} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="mailboxId" value={id} />
          <p className="text-sm">{hasAccess ? CONFIRM : CONFIRM_NO_ACCESS}</p>
          <SubmitButton className={QUIET}>
            Yes, disconnect
            <span data-private className="sr-only">
              : {address}
            </span>
          </SubmitButton>
        </form>
      </details>
    </li>
  );
}
