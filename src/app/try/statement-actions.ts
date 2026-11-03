"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { NEW_ACCOUNT_ID } from "@/config/import";
import {
  STATEMENT_TRIAL_BUSY,
  STATEMENT_TRIAL_MAX_FILE_BYTES,
  STATEMENT_TRIAL_MAX_ROWS,
  STATEMENT_TRIAL_TOO_MANY,
  statementTooBig,
  statementTooManyRows,
} from "@/config/statement-trial";
import { decodeStatement } from "@/data-sources/csv/decode";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { scopedFor } from "@/lib/db-scoped";
import { previewCsvFiles } from "@/lib/import/import-csv";
import { saveUpload } from "@/lib/import/upload";
import { runJob } from "@/lib/jobs";
import { giveBack, hit, ipKey } from "@/lib/rate-limit";
import { sessionOwner, startStatementPerson, statementTrialEnabled } from "@/lib/statement-trial";
import { cleanUpTrials } from "@/lib/trial";
import { clearTrialSession, setTrialSession } from "@/lib/trial-cookie";
import { deleteTrialPerson } from "@/lib/trial-delete";
import { isStatementTrialUser, isTrialUser } from "@/lib/trial-ids";
import type { TryState } from "./actions";

// "Try it with your own statement" on the landing page: no email, a brand new temporary person
// for each start, and the file read in memory and never stored. A file Jane can't read at all
// changes nothing: no person is made, and any earlier try stays until a start that works.

const IP_LIMIT = "trialStatement";
const DAY_LIMIT = "trialStatementDay";
// An error's kind only: its message could quote a row of someone's statement.
const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

export async function tryWithStatement(_previous: TryState, formData: FormData): Promise<TryState> {
  if (!statementTrialEnabled()) return { error: "Trying Jane this way isn't available here." };
  // As at sign-up: the Terms are agreed to before anything is read.
  if (formData.get("consent") !== "on") {
    return { error: "Tick the box to agree to the Terms and Privacy Policy first." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name || file.size === 0) {
    return { error: "Choose a statement file first." };
  }
  if (file.size > STATEMENT_TRIAL_MAX_FILE_BYTES) return { error: statementTooBig() };

  const previous = await sessionOwner(sessionTokenFrom(await cookies()));
  // Signed in with a real account: that person's upload belongs on /import, and starting here
  // would sign them out of it.
  if (previous && !isTrialUser(previous)) {
    return { error: "You're signed in, so upload this on your Upload statements page instead." };
  }

  const h = await headers();
  const ip = ipKey(h);
  if (!(await hit(IP_LIMIT, ip)).ok) return { error: STATEMENT_TRIAL_TOO_MANY };

  // Read here, in memory, before anyone is made.
  const text = decodeStatement(await file.arrayBuffer());
  const [read] = previewCsvFiles([{ name: file.name, text }]);
  // A layout Jane doesn't know goes on, to the column picker on /import; anything else unreadable
  // stops here and isn't counted against the visitor's starts.
  const pickColumns = !read.ok && read.choices !== undefined;
  if (!read.ok && !pickColumns) {
    await giveBack(IP_LIMIT, ip);
    return { error: read.error };
  }
  if (read.ok && read.rowCount === 0) {
    await giveBack(IP_LIMIT, ip);
    return { error: "This file has no transactions in it. Download it again from your bank." };
  }
  if (read.ok && read.rowCount > STATEMENT_TRIAL_MAX_ROWS) {
    await giveBack(IP_LIMIT, ip);
    return { error: statementTooManyRows() };
  }
  if (!(await hit(DAY_LIMIT, "all")).ok) {
    await giveBack(IP_LIMIT, ip);
    return { error: STATEMENT_TRIAL_BUSY };
  }

  const person = await startStatementPerson({ userAgent: h.get("user-agent"), previous }).catch(
    (error) => {
      console.error("Starting a temporary try failed", { error: errorName(error) });
      return null;
    },
  );
  if (!person) return { error: "That didn't go through. Please try again." };
  await setTrialSession(person.sessionToken, person.expires);
  // Other people's finished tries aren't this visitor's wait.
  after(() =>
    cleanUpTrials().catch((error) =>
      console.error("Cleaning up trials failed", { error: errorName(error) }),
    ),
  );
  if (pickColumns) return { next: "/import?columns=1" };

  const upload = new FormData();
  upload.set("accountId", NEW_ACCOUNT_ID);
  if (read.ok) {
    upload.set("new.name", read.account.name);
    upload.set("new.kind", read.account.kind);
  }
  upload.append("files", file);
  const saved = await saveUpload(scopedFor(person.userId), upload).catch(() => null);
  if (!saved?.ok) {
    await deleteTrialPerson(person.userId, "failed_start");
    await clearTrialSession();
    return {
      error:
        saved?.error ?? "Jane couldn't read this file just now. Try again, or try another file.",
    };
  }
  // Saved; the rest runs after the response, its progress on the scanning screen and on a chip.
  after(() =>
    runJob(saved.jobId).then(
      () => undefined,
      (error) => console.error("A temporary try's upload failed", { error: errorName(error) }),
    ),
  );
  return { next: "/scanning" };
}

// "Start over" on the banner: deletes the person this browser holds, now. It takes no id: only
// the session says who, and only someone trying Jane with their own statement can go this way.
export async function startOverTry(): Promise<{ next: string } | { error: string }> {
  const person = await sessionOwner(sessionTokenFrom(await cookies()));
  if (!isStatementTrialUser(person)) return { next: "/" };
  try {
    await deleteTrialPerson(person!, "start_over");
  } catch (error) {
    console.error("Deleting a temporary try failed", { error: errorName(error) });
    return { error: "That didn't go through. Please try again." };
  }
  await clearTrialSession();
  return { next: "/?try=upload&deleted=1" };
}
