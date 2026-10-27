# Encryption keys: adding, rotating and retiring them

Jane encrypts three things before they're saved: bank connection tokens (from Plaid),
two-factor secrets, and uploaded files. A key is what locks and unlocks them. This page is how
you, the founder, change that key safely. **Only you ever handle a key.** Nobody else, no
Claude session and no script, generates, sees, copies or moves one.

## The short version

1. Make a new key on your own computer (one command).
2. Add it in Vercel with a name, and say it's the current one. Redeploy.
3. Open **/admin/keys** and press **Re-encrypt with the current key** until it says it went
   through everything.
4. When the old key shows **0 values · safe to remove**, delete it from Vercel and redeploy.

Nothing breaks in between: Jane reads values made by any key it still has, and new values
use the current key.

## How it works (one paragraph)

Each saved value is labelled with the name of the key that locked it (`v1` for the original
`TOKEN_ENCRYPTION_KEY`, `v2.k2.…` for a key named `k2`). Each value also gets its own random
"data key", which is locked by your key. So moving to a new key only re-locks the small data
key, never the file itself, and a value whose key you still have can always be read.

## 1. Make a new key on your computer

Open Terminal (Mac) and run:

```bash
openssl rand -base64 32
```

It prints one line of about 44 letters, numbers and symbols, ending in `=`. That's the key.
Copy it straight into Vercel (next step). Don't paste it anywhere else: not in chat, email,
Slack, GitHub, a document, or an AI tool. Running the command again gives a different key.

## 2. Add it in Vercel

Vercel → the Jane project → **Settings** → **Environment Variables**. For **Production** (and
Preview too, if your preview deployments use the production database), with **Sensitive**
switched on:

| Name | Value |
| --- | --- |
| `TOKEN_ENCRYPTION_KEYS` | `k2:` followed by the key, e.g. `k2:AbC…xyz=` |
| `TOKEN_ENCRYPTION_KEY_CURRENT` | `k2` |

Leave `TOKEN_ENCRYPTION_KEY` (the original key) exactly as it is for now: it still unlocks
everything saved so far.

Names are up to you (letters, digits, `-` or `_`; not `legacy`). `k2`, `k3`, … is simplest.

Then redeploy: **Deployments** → the latest production deployment → **⋯** → **Redeploy**.
Environment variables only reach a new deployment. (The next merge to main does it too.)

## 3. Check, then re-encrypt

Sign in to Jane as an admin and open **/admin/keys** (the **Keys** link in the team menu).

- No **Fix in Vercel** box. If there is one, it names the problem (for example "Key "k2"
  must be 32 bytes"); fix that variable in Vercel and redeploy. While the current key isn't
  working, new banks can't be linked and new files can't be uploaded, but everything already
  saved still reads.
- The current key says `"k2" · current`.

Press **Re-encrypt with the current key**. Each press works for up to 20 seconds, then shows
what it did. If it says "It ran out of time: press it again", press it again. It's safe to
press as often as you like, and safe if it's interrupted: it only changes values that need it,
and each value is saved on its own. Every press is written to the audit log
(`encryption_keys_rotated`, with counts only).

If it says some values "couldn't be moved", the page lists which key they need (marked
as missing). Usually that's a key you've already removed from Vercel: add it back, redeploy,
and press again.

## 4. Retire the old key

When the page shows the original key as **0 values · not used: safe to remove from Vercel**:

1. Optional but recommended: save the old key in your password manager, labelled "retired
   Jane key", until your database's backup window has passed. A backup restored from before
   the rotation still has values locked with it.
2. Delete `TOKEN_ENCRYPTION_KEY` in Vercel and redeploy.
3. Open /admin/keys again: no **Fix in Vercel** box, and everything is on `k2`.

## Next time (k2 → k3)

1. `openssl rand -base64 32` for a new key.
2. In Vercel set `TOKEN_ENCRYPTION_KEYS` to both keys, comma-separated:
   `k2:<the k2 key>,k3:<the new key>`, and `TOKEN_ENCRYPTION_KEY_CURRENT` to `k3`. Redeploy.
3. /admin/keys → press the button until done.
4. When `k2` shows 0 values, remove the `k2:…` part from `TOKEN_ENCRYPTION_KEYS`. Redeploy.

## When to rotate

- Once a year, as routine (and note the date for the SOC 2 auditor).
- Right away if a key might have been seen by someone who shouldn't have it, or someone with
  Vercel access leaves.

## If something goes wrong

- **A Fix in Vercel box after a change:** fix or undo that one variable in Vercel and redeploy. Values
  are never deleted or overwritten with something unreadable; the worst case is that some
  can't be read until their key is back.
- **To go back to the original key:** clear `TOKEN_ENCRYPTION_KEY_CURRENT` (keep both keys),
  redeploy, and press the button; everything moves back to `TOKEN_ENCRYPTION_KEY`.
- **Never** delete a key while /admin/keys still shows values for it.

## For engineers

- Keyring: `src/lib/keyring.ts`. Formats and rotation: `src/lib/crypto.ts`
  (`encrypt`/`decrypt`, `encryptBytes`/`decryptBytes`, `keyIdOf`, `rotate`). The job and the
  report: `src/lib/key-rotation.ts`. Page: `src/app/admin/keys/`.
- With only `TOKEN_ENCRYPTION_KEY` set, Jane writes the original `v1` format, so older code
  (a rollback) can always read what's written.
  Once `TOKEN_ENCRYPTION_KEY_CURRENT` is set, values are `v2`, which code from before
  cubic1M/Jane#794 can't read: don't roll production back past that PR after that.
- A new encrypted column must be added to `STORES` in `src/lib/key-rotation.ts`, or rotation
  won't reach it and the old key can never be retired.
- Leak checks: `src/lib/secret-leaks.test.ts` (source), `src/lib/key-leak.integration.test.ts`
  and `src/lib/plaid/token-leak.integration.test.ts` (logs, API answers, audit log).
