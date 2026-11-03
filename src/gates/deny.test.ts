import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkBash, checkToolCall, parseCommands } from "../../.claude/hooks/deny.mjs";

const onBranch = (branch: string) => () => branch;
const check = (command: string, branch = "claude/some-lane") =>
  checkBash(command, "/repo", onBranch(branch));
const SHA = "5d990396a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0";

describe("reading a shell command", () => {
  it("splits on operators, outside quotes", () => {
    expect(parseCommands('cd x && git commit -m "a; b" | tail -2')).toEqual([
      ["cd", "x"],
      ["git", "commit", "-m", "a; b"],
      ["tail", "-2"],
    ]);
  });

  it("reads a substitution as a command of its own", () => {
    expect(parseCommands("echo $(git push --force) done")[1]).toEqual(["git", "push", "--force"]);
  });

  it("leaves out a heredoc's text", () => {
    const words = parseCommands("cat > f <<'EOF'\ngit push --force\nEOF\nls");
    expect(words.flat()).not.toContain("push");
    expect(words.at(-1)).toEqual(["ls"]);
  });
});

describe("pushes", () => {
  it.each([
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin feature:refs/heads/main",
    "git push origin :main",
    "cd /repo && git push -q origin main 2>&1 | tail -2",
    "git -C /repo push origin main",
    'bash -c "git push origin main"',
    "FOO=1 git push origin main",
  ])("refuses %s", (command) => {
    expect(check(command)).toContain("no pushes to main");
  });

  it.each(["git push", "git push -q 2>&1", "git push origin", "git push -u origin HEAD"])(
    "refuses %s when on main",
    (command) => {
      expect(check(command, "main")).toContain("no pushes to main");
      expect(check(command, "claude/some-lane")).toBeNull();
    },
  );

  it.each([
    "git push --force",
    "git push -f origin claude/x",
    "git push -q -f -u origin claude/x 2>/dev/null",
    "git push -fu origin claude/x",
    "git push origin +claude/x",
    "git push --force-if-includes origin claude/x",
  ])("refuses %s", (command) => {
    expect(check(command)).toContain("force pushes are off");
  });

  it("refuses a lease with no sha, since any session can move the tracking ref", () => {
    expect(check("git push --force-with-lease")).toContain("--force-with-lease=<branch>");
    expect(check("git push -q --force-with-lease origin claude/x")).toContain("without a sha");
    expect(check("git push --force-with-lease=claude/x origin claude/x")).toContain("without");
  });

  it("allows the rebase flow: a lease pinned to the branch's sha", () => {
    expect(check(`git push -q --force-with-lease=claude/x:${SHA} origin claude/x 2>&1`)).toBeNull();
  });

  it("refuses a pinned lease on main", () => {
    expect(check(`git push --force-with-lease=main:${SHA} origin main`)).toContain("main");
  });

  it.each([
    "git push -q -u origin claude/x 2>&1 | tail -1",
    "git push origin HEAD:claude/x",
    "git push -u origin HEAD",
    "git push origin main-page-fix",
    "git fetch -q origin main",
    "git log origin/main --oneline",
    'git commit -m "never git push origin main or --force"',
    'echo "git push --force"',
    "gh pr view 12 --json body | grep 'git push origin main'",
  ])("allows %s", (command) => {
    expect(check(command)).toBeNull();
  });
});

describe("commands inside other commands", () => {
  it.each([
    "timeout 5 git push origin main",
    "timeout -k 2 5 git push origin main",
    "gtimeout 60 vercel deploy",
    'echo "$(git push origin main)"',
    'echo "done: $(git push origin main 2>&1 | tail -1)"',
    'echo "`git push origin main`"',
    "echo $(git push origin main)",
  ])("refuses %s", (command) => {
    expect(check(command)).not.toBeNull();
  });

  it.each([
    "timeout 5 git status",
    'echo "branch: $(git branch --show-current)"',
    "echo 'git push origin main'",
    "echo '$(git push origin main)'",
    'echo "\\$(git push origin main)"',
  ])("allows %s", (command) => {
    expect(check(command)).toBeNull();
  });
});

describe("hand deploys", () => {
  it.each([
    "vercel deploy --prod --yes",
    "vercel --prod",
    "vercel",
    "npx vercel deploy",
    "npx -y vercel --prod",
    "npm exec vercel deploy",
    "vercel promote https://x.vercel.app",
    "vercel rollback",
    "vercel redeploy abc",
    "vercel rm abc",
    "/usr/local/bin/vercel deploy",
    'sh -c "cd /tmp/x && vercel deploy --prod"',
  ])("refuses %s", (command) => {
    expect(check(command)).toContain("no hand deploys");
  });

  it.each([
    "vercel ls",
    "vercel logs https://x.vercel.app",
    "vercel inspect abc",
    "vercel whoami",
    "vercel --version",
    "vercel env ls production",
    "npx vercel logs abc",
    // The deploy loop is the one thing that deploys; a session may restart it.
    "nohup bash /tmp/scratch/instant-deploy.sh > /tmp/log 2>&1 &",
    "pgrep -f instant-deploy.sh",
    "grep -n 'vercel deploy' docs/architecture.md",
    "cat > loop.sh <<'EOF'\nvercel deploy --prod\nEOF",
  ])("allows %s", (command) => {
    expect(check(command)).toBeNull();
  });

  it("refuses pulling production's secrets to a file", () => {
    expect(check("vercel env pull .env.local")).toContain("vercel env pull");
  });
});

describe("gh", () => {
  it.each(["gh pr update-branch 12", "gh api -X PUT repos/a/b/pulls/12/update-branch"])(
    "refuses %s",
    (command) => {
      expect(check(command)).toContain("unattributed commit");
    },
  );

  it("refuses an admin merge", () => {
    expect(check("gh pr merge 12 --admin --squash")).toContain("--admin");
  });

  it.each([
    "gh pr review 12 --approve",
    "gh pr review 12 -a",
    "gh api -X POST repos/a/b/pulls/12/reviews -f event=APPROVE",
  ])("refuses an agent approving a PR: %s", (command) => {
    expect(check(command)).toContain("only a founder approves");
  });

  it("refuses checking out a PR, which would run its hooks and test config here", () => {
    expect(check("gh pr checkout 12")).toContain("gh pr diff");
  });

  it("refuses changing who counts as a founder, or main's ruleset", () => {
    expect(check("gh variable set FOUNDER_LOGINS --body x")).toContain("FOUNDER_LOGINS");
    expect(check("gh api -X PUT repos/a/b/rulesets/1 --input f.json")).toContain("ruleset");
  });

  it.each([
    "gh pr merge 12 --auto --squash",
    "gh pr edit 12 --add-label e2e",
    "gh pr review 12 --comment --body looks-fine",
    "gh pr diff 12",
    "gh api repos/a/b/pulls/12/reviews",
    "gh api repos/a/b/rulesets/1",
    "gh variable list",
  ])("allows %s", (command) => {
    expect(check(command)).toBeNull();
  });
});

describe(".env files", () => {
  it.each([
    "cat .env",
    "cat .env.local",
    "sed 's/=.*//' /Users/a/Jane/.env",
    "grep KEY .env.test",
    'source "$ROOT/.env"',
    "cp .env /tmp/x",
    "printf 'A=1' >> .env.local",
    "cat > .env.local <<EOF\nA=1\nEOF",
    "git add .env.local",
    "echo A=1 > .env.local",
    "git commit -m x > .env",
    "cat .env*",
    `python3 -c "print(open('.env').read())"`,
    `python3 - <<'EOF'\nprint(open(".env.local").read())\nEOF`,
  ])("refuses %s", (command) => {
    expect(check(command)).toContain("dev-localdb");
  });

  it.each([
    "ls -la .env",
    "test -f .env.local",
    "git check-ignore -v .env",
    "grep -n KEY .env.example",
    "cat .env.example",
    "grep -rn process.env src",
    `python3 -c "print(open('.env.example').read())"`,
    "cat > notes.md <<'EOF'\nsee .env.local\nEOF",
    'git commit -m "fix: see config/.env handling"',
    'git commit -m "see config/.env"',
    'gh pr create --title x --body "see config/.env"',
    "echo .env",
  ])("allows %s", (command) => {
    expect(check(command)).toBeNull();
  });

  it.each([
    ["Read", { file_path: "/repo/.env" }],
    ["Read", { file_path: "/repo/.env.local" }],
    ["Write", { file_path: "/repo/.env.local" }],
    ["Edit", { file_path: ".env" }],
    ["Grep", { path: "/repo/.env" }],
  ])("refuses %s of one", (tool_name, tool_input) => {
    expect(checkToolCall({ tool_name, tool_input, cwd: "/repo" })).toContain("dev-localdb");
  });

  it("allows .env.example, which CLAUDE.md asks to keep up to date", () => {
    for (const tool_name of ["Read", "Edit"]) {
      const tool_input = { file_path: "/repo/.env.example" };
      expect(checkToolCall({ tool_name, tool_input, cwd: "/repo" })).toBeNull();
    }
  });
});

describe("src/config/advice.ts", () => {
  it.each(["Write", "Edit", "MultiEdit"])("refuses %s", (tool_name) => {
    const tool_input = { file_path: "/repo/src/config/advice.ts" };
    expect(checkToolCall({ tool_name, tool_input, cwd: "/repo" })).toContain("REAL_ACCOUNT_ADVICE");
  });

  it("refuses a relative path through the tools", () => {
    const call = {
      tool_name: "Edit",
      tool_input: { file_path: "src/config/advice.ts" },
      cwd: "/r",
    };
    expect(checkToolCall(call)).toContain("REAL_ACCOUNT_ADVICE");
  });

  it.each([
    "sed -i '' s/false/true/ src/config/advice.ts",
    "perl -pi -e s/false/true/ src/config/advice.ts",
    "echo x > src/config/advice.ts",
    "echo x >> src/config/advice.ts",
    "cp /tmp/x src/config/advice.ts",
    "mv /tmp/x src/config/advice.ts",
    "rm src/config/advice.ts",
    "git checkout HEAD~3 -- src/config/advice.ts",
    "cd src && rm config/advice.ts",
    `python3 - <<'EOF'\np='src/config/advice.ts'\nopen(p,'w').write('x')\nEOF`,
    `node -e "require('fs').writeFileSync('src/config/advice.ts','x')"`,
  ])("refuses %s", (command) => {
    expect(check(command)).toContain("REAL_ACCOUNT_ADVICE");
  });

  it("allows a script that only mentions it in another file's words", () => {
    const command = `python3 - <<'EOF'\ns=open('docs/x.md').read()\nopen('docs/x.md','w').write(s+"see \`src/config/advice.ts\`")\nEOF`;
    expect(check(command)).toBeNull();
  });

  it("allows reading it", () => {
    const call = {
      tool_name: "Read",
      tool_input: { file_path: "src/config/advice.ts" },
      cwd: "/r",
    };
    expect(checkToolCall(call)).toBeNull();
    expect(check("cat src/config/advice.ts")).toBeNull();
    expect(check("git log -3 -- src/config/advice.ts")).toBeNull();
    expect(check("npx vitest run src/config/advice.test.ts")).toBeNull();
  });
});

describe("other tools", () => {
  it("leaves everyday files alone", () => {
    const call = { tool_name: "Write", tool_input: { file_path: "src/lib/x.ts" }, cwd: "/r" };
    expect(checkToolCall(call)).toBeNull();
    expect(checkToolCall({ tool_name: "Bash", tool_input: { command: "npm test" } })).toBeNull();
  });
});

describe("the hook as Claude Code runs it", () => {
  const run = (input: unknown) =>
    spawnSync("sh", [".claude/hooks/node.sh", "deny.mjs"], {
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
    });

  it("exits 2 with the reason on a refusal", () => {
    const refused = run({ tool_name: "Bash", tool_input: { command: "vercel deploy" }, cwd: "/" });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("no hand deploys");
  });

  it("exits 0 otherwise", () => {
    const fine = run({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: "/" });
    expect(fine.status).toBe(0);
  });

  it("steps aside on input it can't read, rather than stopping a session", () => {
    expect(run("not json").status).toBe(0);
  });
});
