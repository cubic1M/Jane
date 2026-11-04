#!/usr/bin/env node
// Adds one result to the ops-numbers branch, from a job with write rights that ran no agent and no
// app code. Accepts only flat records of numbers, booleans and short names, so nothing else can be
// carried across to a public branch.
import { writeData } from "./data-branch.mjs";

const SHORT = /^[\w.:@/ -]{1,60}$/;

export function acceptable(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  return Object.values(record).every(
    (value) =>
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      (typeof value === "string" && SHORT.test(value)),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file] = process.argv.slice(2);
  if (!["canary.jsonl", "holdouts.jsonl"].includes(file)) process.exit(2);
  const record = JSON.parse(process.env.RECORD ?? "null");
  if (!acceptable(record)) {
    console.log("Refused: not a plain record.");
    process.exit(1);
  }
  writeData(`Result for ${file}`, (read) => ({
    [file]: `${read(file)}${JSON.stringify(record)}\n`,
  }));
  console.log("Recorded.");
}
