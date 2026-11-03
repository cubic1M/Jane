// Every action the watch takes, on the public ops-numbers branch (the numbers page reads it), so
// it holds short codes and times only. A phone gets the plain words.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readData, writeData } from "./data-branch.mjs";
import { parseJsonl } from "./numbers-core.mjs";

const FILE = "actions.jsonl";
const local = () => process.env.OPS_LOG_FILE;
const REPO = process.env.GITHUB_REPOSITORY ?? "cubic1M/Jane";
export const FREEZE_LABEL = "deploy-freeze";

export function readLog() {
  const file = local();
  if (file) return existsSync(file) ? parseJsonl(readFileSync(file, "utf8")) : [];
  return parseJsonl(readData(FILE));
}

export function logAction(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  const file = local();
  if (file) appendFileSync(file, line);
  else writeData(`Ops: ${entry.kind}`, (read) => ({ [FILE]: read(FILE) + line }));
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();

export function isFrozen() {
  if (local()) return readLog().some((a) => a.kind === "freeze");
  const open = gh(
    "issue",
    "list",
    "-R",
    REPO,
    "--label",
    FREEZE_LABEL,
    "--state",
    "open",
    "--json",
    "number",
    "-q",
    "length",
  );
  return Number(open) > 0;
}

// An open issue is the freeze: public, logged, and it needs no setting anywhere. A person closes it.
export function freeze(trigger) {
  if (isFrozen()) return;
  if (!local()) {
    gh("label", "create", FREEZE_LABEL, "-R", REPO, "--force", "--color", "B60205");
    gh(
      "issue",
      "create",
      "-R",
      REPO,
      "--label",
      FREEZE_LABEL,
      "--title",
      "Deploys frozen by the watch",
      "--body",
      `Trigger: \`${trigger}\`. Close this once production is checked: docs/ops.md says how, including undoing a rollback.`,
    );
  }
}
