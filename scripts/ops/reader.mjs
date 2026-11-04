#!/usr/bin/env node
// The reader agent, run by .github/workflows/incident-reader.yml when the watch has fired. Reads the
// evidence and sends a person one short guess. No write token, no way to change anything, and the
// watch never reads its answer. One call per incident, at low effort, on its own key. Prints only
// whether it sent something, since the repo's logs are public.
import Anthropic from "@anthropic-ai/sdk";
import { page } from "./page.mjs";
import {
  ADVICE_SCHEMA,
  READER_SYSTEM,
  pageText,
  parseAdvice,
  userMessage,
} from "./reader-core.mjs";

const SITE = process.env.SITE ?? "https://jane-dusky.vercel.app";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/** @param {unknown} evidence @param {{ client: { beta: { messages: { create: (body: any) => Promise<any> } } } }} options */
export async function advise(evidence, { client }) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ADVICE_SCHEMA } },
    system: READER_SYSTEM,
    messages: [{ role: "user", content: userMessage(evidence) }],
  });
  if (response.stop_reason !== "end_turn") return null;
  const text = response.content.find(
    (/** @type {{ type: string }} */ block) => block.type === "text",
  );
  return parseAdvice(text?.text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const response = await fetch(`${SITE}/api/ops/evidence`, {
    headers: { authorization: `Bearer ${process.env.OPS_READ_SECRET}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  // The site being down is itself something to tell the model, so an empty read still goes on.
  const evidence = response?.ok ? await response.json() : { evidence_unavailable: true };
  const advice = await advise(evidence, {
    client: new Anthropic({ apiKey: process.env.READER_ANTHROPIC_KEY }),
  }).catch(() => null);
  const sent = advice ? await page(pageText(advice)) : false;
  console.log(sent ? "Advice sent." : "No advice sent.");
}
