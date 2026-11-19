import { POSTGRID } from "@/config/connectors";
import { isTrialUser } from "@/lib/trial-ids";
import { nextMidnightEastern, parsePostGridEvent, sandboxLetters } from "../sandbox/letters";
import { BadRequest, type ActionDetails, type Connector } from "../types";
import { postGridTestHttp, usAddress } from "./api";

// Letters to a company through PostGrid's test mode (batch-2 connectors; postgrid.readme.io, read
// 2026-11-19): the same letter as the sandbox's, now made at PostGrid, previewed there and never
// mailed. For sample people only (sandbox: true): who it's from and to come from Jane's own records
// through the sandbox letters' prepare and guard (the person's own name; only a company Jane knows
// takes a letter, at its documented address). A real one waits for the person's mailing address,
// REAL_CONNECTORS and a live key, none of which are here. A trial person's letter stays in the plain
// sandbox, which calls nobody.

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

// The day on the letter, as PostGrid's day in New York: "November 19, 2026".
export const mailingDay = (now: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "long" }).format(now);

// The letter itself: plain words, the person's name, and who wrote it. No account number or other
// identifier, which Jane doesn't keep.
export function letterHtml(details: ActionDetails, day: string): string {
  const company = escape(String(details.company));
  const name = escape(String(details.fromName));
  const asks =
    details.purpose === "stop_payment"
      ? `Please stop taking any payments from me, ${name}, and confirm in writing that you have.`
      : `Please cancel my account, in the name of ${name}, and confirm the cancellation in writing.`;
  return [
    "<html><body>",
    `<p>${escape(day)}</p>`,
    `<p>To ${company}:</p>`,
    `<p>${asks}</p>`,
    `<p>${name}</p>`,
    `<p>Written by Jane, an AI assistant, for ${name}, with their yes.</p>`,
    "</body></html>",
  ].join("");
}

export function postGridTestLetters(api = postGridTestHttp()): Connector {
  return {
    ...sandboxLetters,
    id: "sandbox_postgrid_letters",
    name: "Letters to a company, through PostGrid's test mode (nothing is mailed)",
    act: async (draft, context) => {
      // A trial person's name goes nowhere, not even to a test mode: the plain sandbox answers.
      if (isTrialUser(context.userId)) return sandboxLetters.act!(draft, context);
      const to = usAddress(String(draft.details.toAddress));
      if (!to) throw new BadRequest("the company's address doesn't read as a US address");
      const from = String(draft.details.fromName).split(/\s+/);
      const id = await api.createLetter({
        to: { ...to, companyName: String(draft.details.company) },
        from: {
          ...POSTGRID.testSender,
          firstName: from[0] ?? "",
          ...(from.length > 1 ? { lastName: from.slice(1).join(" ") } : {}),
        },
        html: letterHtml(draft.details, mailingDay(context.now)),
        description: `${draft.kind} for action ${context.actionId}`,
        janeKey: context.idempotencyKey,
      });
      return {
        externalRef: id,
        state: "pending",
        cancelUntil: nextMidnightEastern(context.now),
        note: `Made in PostGrid's test mode: nothing is mailed. Letter to ${String(draft.details.company)}.`,
      };
    },
    cancel: async (externalRef, context) =>
      isTrialUser(context.userId)
        ? sandboxLetters.cancel!(externalRef, context)
        : api.cancel(externalRef),
    webhook: {
      signing: {
        kind: "hmac_sha256_tv",
        secretEnv: POSTGRID.webhookSecretEnv,
        header: POSTGRID.signatureHeader,
        timestampUnit: "ms",
      },
      parse: parsePostGridEvent,
    },
  };
}

export const sandboxPostgridLetters = postGridTestLetters();
