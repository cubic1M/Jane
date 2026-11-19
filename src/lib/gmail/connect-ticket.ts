import { createHash, timingSafeEqual } from "node:crypto";
import { GMAIL_LIMITS } from "@/config/gmail";
import { GMAIL_DISCLOSURE_VERSION } from "@/config/gmail-disclosure";
import { open, seal } from "./sealed";

// The ticket in the Connect link on the mailboxes page. A sign-in link signs in whichever browser
// opens it (src/lib/sign-in-link.ts), so a link someone else sent could put a person in the
// sender's Jane account and, with the right address on the end, straight onto Google's page: their
// mailbox would then be connected to the sender's account. The connect route goes on only with a
// ticket that the mailboxes page made for this person, in this browser's own session, a short
// while ago, under the words shown on that page. Someone else can't know the session a tap on
// their link creates, so they can't make its ticket. The session token itself is never kept: only
// its hash is sealed.

const PURPOSE = "gmail_connect";

const hashOf = (sessionToken: string): Buffer => createHash("sha256").update(sessionToken).digest();

export function makeTicket(userId: string, sessionToken: string, now: Date): string {
  const ticket = {
    session: hashOf(sessionToken).toString("base64url"),
    disclosure: GMAIL_DISCLOSURE_VERSION,
  };
  return seal(PURPOSE, userId, ticket, now);
}

// Whether a ticket is this person's, from this session, still fresh and made under the words now
// shown: then the version of those words, which is what they agreed to. Otherwise null, and nothing
// starts.
export function ticketHolds(
  ticket: string | null | undefined,
  { userId, sessionToken, now }: { userId: string; sessionToken: string | undefined; now: Date },
): { disclosure: string } | null {
  if (!sessionToken) return null;
  const inside = open(ticket, PURPOSE, userId, GMAIL_LIMITS.ticketMinutes * 60_000, now);
  if (typeof inside !== "object" || inside === null) return null;
  const { session, disclosure } = inside as Record<string, unknown>;
  if (typeof session !== "string" || typeof disclosure !== "string") return null;
  const sealed = Buffer.from(session, "base64url");
  const mine = hashOf(sessionToken);
  // The same time whichever byte differs, so the answer doesn't say how close a guess came.
  if (sealed.length !== mine.length || !timingSafeEqual(sealed, mine)) return null;
  return disclosure === GMAIL_DISCLOSURE_VERSION ? { disclosure } : null;
}
