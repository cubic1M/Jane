import type { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";

type Mail = Parameters<typeof sendEmail>[0];

// One message to every address on the team. A failure to one inbox must not read as a failure of
// the whole send: whoever it already reached would get it again on the retry. So it throws only
// when NO address took it (the caller gives its claim back and tries again later); when some did,
// the ones that failed are said in the log and the send counts as made.
export async function sendToAny(
  to: readonly string[],
  message: Omit<Mail, "to"> | ((address: string) => Omit<Mail, "to">),
  send: typeof sendEmail,
): Promise<number> {
  const results = await Promise.allSettled(
    to.map((address) =>
      send({ ...(typeof message === "function" ? message(address) : message), to: address }),
    ),
  );
  const delivered = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
  if (delivered === 0 && failed.length > 0) throw failed[0];
  if (failed.length > 0) {
    log.error("Team email missed some addresses", {
      delivered,
      failed: failed.length,
      error: String(failed[0]),
    });
  }
  return delivered;
}
