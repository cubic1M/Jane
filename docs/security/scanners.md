# Security scanners

`.github/workflows/scanners.yml` runs on every pull request, on main and weekly. Findings from
main go to the repository's Security tab (Code scanning), which only people with write access can
see.

| Scanner | Finds | On a pull request | Cost |
| --- | --- | --- | --- |
| CodeQL (`security-extended`, `.github/codeql/codeql-config.yml`) | How data flows from input to a dangerous place: XSS, injection, log injection | Fails on new high-severity alerts, through GitHub's code scanning check | Free on a public repository. If the repository goes private it needs GitHub Advanced Security |
| Semgrep free rules | `p/typescript`, `p/nextjs`, `p/react`, `p/nodejs`, `p/owasp-top-ten`, `p/secrets` | Fails only on what the pull request adds | Free, no login, no code leaves the runner except rule downloads |
| Semgrep, Jane's rules (`.semgrep/rules/jane.yaml`) | The two things below | Same | Free |
| `npm audit` (the "Dependency audit" job in `ci.yml`) | Known high or critical holes in what ships to production | Fails on any | Free |
| gitleaks (the "Secret scan" job in `ci.yml`) | Keys in any pushed branch | Fails on any | Free |

Socket, for malicious packages, is an app a founder has to install.

## Jane's two rules

- **`jane-user-table-query-without-scope`:** a Prisma call on a user-owned table with no `userId`
  in its `where`. Generic scanners can't see this, because to them it's a normal query.
- **`jane-log-sensitive-value`:** a token, email or statement content passed to `console` or `log`.
  `src/lib/log.ts` would clean it anyway, but this catches the mistake at the source.

`semgrep --test .semgrep/rules` runs the cases in `.semgrep/rules/jane.ts`, in CI too.
`src/security/semgrep-rules.test.ts` fails when a table with a `userId` is missing from the first
rule's list, so add new tables there.

## When one fails on your pull request

1. Believe it first. Read what it found.
2. Fix it: `scopedFor(userId)` for a query, an id or a count for a log line.
3. If it truly is fine, say why on the line above it, and name who runs the code:

   ```ts
   // nosemgrep: jane-user-table-query-without-scope -- daily retention job, across everyone
   ```

For CodeQL, dismiss the alert in the Security tab with a reason. An alert on code that exists
today gets the same treatment: fix it, or dismiss it with a reason, one by one.

## Why main's Semgrep job doesn't fail

It only reports. Old findings shouldn't turn every commit on main red, and a pull request still
can't add new ones.

## Limits

- A scanner can't tell whether this person may read this row. `docs/security/access-proof.md` is
  the real test of that.
- The query rule reads the text of the call. A `where` held in a variable counts as missing a
  user, and raw SQL isn't checked.
- Semgrep skips what it can't parse in a few `.tsx` lines and scans the rest of the file.
