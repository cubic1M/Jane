// PreToolUse hook: stops the moves a session must never make. Exit 2 refuses the tool call and
// shows the reason to the session. These are guardrails against a slip, not a wall (a script can
// still do any of this); CI's gates are the real control. Rules tested in src/gates/deny.test.ts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = new Set(["main", "master", "refs/heads/main", "refs/heads/master"]);
const FOUNDER_LABEL = "founder-approved";

// Text of a heredoc is data unless a shell reads it, and never one of these commands' arguments.
function stripHeredocs(command) {
  const lines = command.split("\n");
  const kept = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.replace(/^\t+/, "") === end) end = null;
      continue;
    }
    kept.push(line);
    const found = /(?<!<)<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w.-]*))/.exec(line);
    if (found) end = found[1] ?? found[2] ?? found[3];
  }
  return kept.join("\n");
}

/** Words of a shell command, split at ; && || | & and newlines, with quoted text kept whole. */
export function parseCommands(input) {
  const command = stripHeredocs(input);
  const commands = [];
  let words = [];
  let word = "";
  let started = false;
  const endWord = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      word += command.slice(i + 1, close < 0 ? undefined : close);
      started = true;
      i = close < 0 ? command.length : close;
    } else if (c === '"') {
      started = true;
      for (i += 1; i < command.length && command[i] !== '"'; i += 1) {
        if (command[i] === "\\" && i + 1 < command.length) i += 1;
        word += command[i];
      }
    } else if (c === "\\" && i + 1 < command.length) {
      if (command[i + 1] !== "\n") word += command[i + 1];
      started = started || command[i + 1] !== "\n";
      i += 1;
    } else if (c === "#" && !started) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i += 1;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&" || c === "(" || c === ")") {
      // 2>&1 and >&2 are redirections, not the end of a command.
      if (c === "&" && (command[i - 1] === ">" || command[i + 1] === ">")) {
        word += c;
        started = true;
      } else endCommand();
    } else if (c === "`" || (c === "$" && command[i + 1] === "(")) {
      // A substitution runs too: its command is read on its own, the word it sits in goes on.
      if (c === "$") i += 1;
      endCommand();
    } else if (c === ">" || c === "<") {
      endWord();
      words.push(c);
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      word += c;
      started = true;
    }
  }
  endCommand();
  return commands;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(["command", "exec", "nohup", "time", "sudo", "env", "nice", "builtin"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

function realWords(words) {
  let rest = words;
  for (;;) {
    while (rest.length && ASSIGNMENT.test(rest[0])) rest = rest.slice(1);
    if (rest.length && WRAPPERS.has(basename(rest[0]))) rest = rest.slice(1);
    else if (rest.length && rest[0].startsWith("-") && rest !== words) rest = rest.slice(1);
    else return rest;
  }
}

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

const FORCE_ADVICE =
  "Rebase, then push your own branch with --force-with-lease=<branch>:<its remote sha> " +
  "(git ls-remote origin <branch> gives the sha).";

function checkPush(args, cwd, branchOf) {
  const positional = [];
  let forced = false;
  let lease = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--force" || a === "--force-if-includes") forced = true;
    else if (a === "--force-with-lease") lease = "bare";
    else if (a.startsWith("--force-with-lease=")) lease = a.includes(":") ? "pinned" : "bare";
    else if (/^-[a-zA-Z]+$/.test(a)) {
      if (a.includes("f")) forced = true;
      if (a.includes("o")) i += 1;
    } else if (a === "--repo" || a === "--receive-pack" || a === "--push-option") i += 1;
    else if (!a.startsWith("-") && a !== ">" && a !== "<" && !/^\d?&?\d?$/.test(a)) {
      positional.push(a);
    } else if (a === ">" || a === "<") i += 1;
  }
  const refspecs = positional.slice(1);
  if (forced || refspecs.some((r) => r.startsWith("+"))) {
    return `force pushes are off. ${FORCE_ADVICE}`;
  }
  if (lease === "bare") {
    return (
      "--force-with-lease without a sha checks a tracking ref any session may have moved " +
      `(all worktrees share one .git). ${FORCE_ADVICE}`
    );
  }
  const targets = refspecs.map((r) => (r.includes(":") ? r.slice(r.indexOf(":") + 1) : r));
  const head = branchOf(cwd);
  const toMain =
    targets.some((t) => MAIN.has(t)) ||
    (MAIN.has(head) && (targets.length === 0 || targets.includes("HEAD")));
  return toMain ? "no pushes to main. Open a pull request from a branch." : null;
}

function checkGit(args, cwd, branchOf) {
  let here = cwd;
  let rest = args;
  while (rest.length && rest[0].startsWith("-")) {
    if (rest[0] === "-C") {
      here = resolve(cwd, rest[1] ?? ".");
      rest = rest.slice(2);
    } else if (rest[0] === "-c" || rest[0] === "--git-dir" || rest[0] === "--work-tree") {
      rest = rest.slice(2);
    } else rest = rest.slice(1);
  }
  return rest[0] === "push" ? checkPush(rest.slice(1), here, branchOf) : null;
}

function checkGh(args) {
  const words = args.filter((a) => a !== ">" && a !== "<");
  const [one, two] = words;
  if (one === "pr" && two === "update-branch") {
    return (
      "gh pr update-branch makes an unattributed commit that blocks merging. " +
      "Rebase or merge origin/main locally and push your own commit."
    );
  }
  if (one === "pr" && two === "merge" && words.includes("--admin")) {
    return "gh pr merge --admin goes around the checks. Let the required checks pass.";
  }
  if (one === "api" && words.some((w) => /\/update-branch\b/.test(w))) {
    return "the update-branch API makes an unattributed commit that blocks merging.";
  }
  if (words.includes(FOUNDER_LABEL)) {
    const reads =
      (one === "pr" && (two === "list" || two === "view")) ||
      (one === "search" && two === "prs") ||
      (one === "label" && two === "list");
    if (!reads) return `only a founder applies "${FOUNDER_LABEL}". Tell a founder what needs it.`;
  }
  if (one === "api" && words.some((w) => /\/labels\b/.test(w))) {
    const body = words.join(" ");
    if (body.includes(FOUNDER_LABEL)) {
      return `only a founder applies "${FOUNDER_LABEL}". Tell a founder what needs it.`;
    }
  }
  if (
    one === "variable" &&
    (two === "set" || two === "delete") &&
    words.includes("FOUNDER_LOGINS")
  ) {
    return "FOUNDER_LOGINS says who may approve a gate, and only a founder changes it.";
  }
  if (one === "api" && words.some((w) => /\/rulesets\b/.test(w))) {
    const method = words[words.findIndex((w) => w === "-X" || w === "--method") + 1];
    const writes = (words.includes("-X") || words.includes("--method")) && method !== "GET";
    if (writes) return "main's ruleset is the founders' to change.";
  }
  return null;
}

const VERCEL_READS = new Set([
  "logs",
  "ls",
  "list",
  "inspect",
  "whoami",
  "usage",
  "--version",
  "-v",
  "--help",
  "-h",
  "help",
  "project",
  "projects",
  "domains",
  "dns",
  "teams",
  "certs",
  "link",
]);

function checkVercel(args) {
  const words = args.filter((a) => a !== ">" && a !== "<");
  const first = words.find((w) => !w.startsWith("-") || VERCEL_READS.has(w));
  if (first === "env") {
    return words.includes("pull")
      ? "vercel env pull writes production secrets to a file. Read names with vercel env ls."
      : null;
  }
  if (first && VERCEL_READS.has(first)) return null;
  return "no hand deploys: the deploy loop ships main's head (and rolls back). A founder can run this in their own terminal.";
}

const isEnvFile = (path) => {
  const name = basename(path);
  return /^\.env/.test(name) && name !== ".env.example";
};

const ENV_ADVICE =
  "secrets live in .env files and sessions don't read or write them (.env.example is fine). For a " +
  "local server, pass settings on the command line or use the dev-localdb entry in .claude/launch.json.";

const INTERPRETERS = /^(python3?|node|ruby|perl)$/;
const ENV_IN_CODE = /['"`]([^'"`]*\/)?\.env(?:\.(?!example\b)[\w.]+)?['"`]/;

// Looking at whether the file is there, without reading it.
const ENV_STAT = new Set(["ls", "stat", "test", "["]);

function checkEnvWords(name, args) {
  if (ENV_STAT.has(name)) return null;
  if (name === "git" && args.includes("check-ignore")) return null;
  for (const arg of args) {
    if (isEnvFile(arg) || /^\.env\*/.test(basename(arg))) return `${arg}: ${ENV_ADVICE}`;
    const inline = ENV_IN_CODE.exec(arg);
    if (inline && (SHELLS.has(name) || INTERPRETERS.test(name))) {
      return `${inline[0]}: ${ENV_ADVICE}`;
    }
  }
  return null;
}

const ADVICE_FILE = /(^|\/)src\/config\/advice\.ts$/;
const ADVICE_REASON =
  "src/config/advice.ts holds REAL_ACCOUNT_ADVICE, which stays false until a licensed partner is " +
  "connected and counsel signs off. A founder changes this file.";
const WRITERS = new Set(["rm", "mv", "cp", "tee", "truncate", "dd", "chmod", "ln", "install"]);
const writesAdviceInline = (code) =>
  /["']([^"'\s]*\/)?config\/advice\.ts["']/.test(code) &&
  /\b(write|writeFile|writeFileSync|open\([^)]*["']w)/.test(code);

function isAdvicePath(arg, cwd) {
  return ADVICE_FILE.test(isAbsolute(arg) ? arg : join(cwd, arg));
}

function checkAdviceWords(name, args, cwd) {
  const inPlace =
    (name === "sed" || name === "perl" || name === "gsed") &&
    args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a));
  const gitWrites =
    name === "git" && args.some((a) => ["checkout", "restore", "rm", "mv"].includes(a));
  const writes = WRITERS.has(name) || inPlace || gitWrites;
  for (let i = 0; i < args.length; i += 1) {
    if (!isAdvicePath(args[i], cwd)) continue;
    if (writes || args[i - 1] === ">") return ADVICE_REASON;
  }
  if (INTERPRETERS.test(name) && args.some(writesAdviceInline)) return ADVICE_REASON;
  return null;
}

// A script in a heredoc is the usual way a session edits a file by hand, so it's read too.
function checkScriptHeredoc(command) {
  if (!/\b(python3?|node|ruby|perl)\b[^\n]*<</.test(command)) return null;
  if (writesAdviceInline(command)) return ADVICE_REASON;
  const env = ENV_IN_CODE.exec(command);
  return env ? `${env[0]}: ${ENV_ADVICE}` : null;
}

/** Why a Bash command must not run, or null. `branchOf` reads a folder's branch (a test passes its own). */
export function checkBash(command, cwd, branchOf = currentBranch, depth = 0) {
  const script = checkScriptHeredoc(command);
  if (script) return script;
  let here = cwd;
  for (const raw of parseCommands(command)) {
    const words = realWords(raw);
    if (!words.length) continue;
    const name = basename(words[0]);
    const args = words.slice(1);
    if (name === "cd" && args[0] && !args[0].startsWith("-")) {
      here = resolve(here, args[0]);
      continue;
    }
    if (SHELLS.has(name) && depth < 3) {
      const at = args.findIndex((a) => /^-[a-z]*c$/.test(a));
      if (at >= 0 && args[at + 1]) {
        const inner = checkBash(args[at + 1], here, branchOf, depth + 1);
        if (inner) return inner;
      }
    }
    if (name === "eval" && depth < 3) {
      const inner = checkBash(args.join(" "), here, branchOf, depth + 1);
      if (inner) return inner;
    }
    let reason = null;
    if (name === "git") reason = checkGit(args, here, branchOf);
    else if (name === "gh") reason = checkGh(args);
    else if (name === "vercel") reason = checkVercel(args);
    else if (name === "npx" || name === "bunx") {
      const inner = args.filter((a) => !a.startsWith("-"));
      if (basename(inner[0] ?? "") === "vercel") reason = checkVercel(inner.slice(1));
    } else if (name === "npm" && args[0] === "exec") {
      const inner = args.slice(1).filter((a) => !a.startsWith("-"));
      if (basename(inner[0] ?? "") === "vercel") reason = checkVercel(inner.slice(1));
    }
    reason ??= checkEnvWords(name, words.slice(1));
    reason ??= checkAdviceWords(name, args, here);
    if (reason) return reason;
  }
  return null;
}

/** Why this tool call must not run, or null. */
export function checkToolCall(call, branchOf) {
  const { tool_name: tool, tool_input: input = {}, cwd = process.cwd() } = call;
  if (tool === "Bash") return checkBash(input.command ?? "", cwd, branchOf);
  const path = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof path !== "string") return null;
  if (isEnvFile(path)) return `${path}: ${ENV_ADVICE}`;
  const writes =
    tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit";
  if (writes && isAdvicePath(path, cwd)) return ADVICE_REASON;
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let reason = null;
  try {
    reason = checkToolCall(JSON.parse(readFileSync(0, "utf8")));
  } catch {
    // A hook that can't read its input steps aside rather than stopping a session's work.
  }
  if (reason) {
    process.stderr.write(`Refused by .claude/hooks/deny.mjs: ${reason}\n`);
    process.exit(2);
  }
}
