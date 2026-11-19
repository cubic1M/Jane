# Gmail mailboxes

A person connects one or more of their own Gmail mailboxes, on Google's sign-in page, and Jane lists
the emails in them about their money: bills, receipts, renewals, price changes and refunds. It's
off: until `GMAIL_LINK` is exactly `1` there is no Connect link, the connect, callback and webhook
routes answer 404, and nothing is read. Google's side takes about an hour to set up the first time.

The Google pages linked below were read on 2026-11-18, and the quotes are word for word. Google
moves its menus and rewrites its pages: open a page before relying on a line, and use the console's
search bar when a menu has moved. Where Google's pages disagree, or say nothing, this page says so.

## What Jane reads

Jane asks for `https://www.googleapis.com/auth/gmail.readonly` alone (`GMAIL_SCOPE`), so there's no
box to untick: "For applications that request only one non-Sign-In scope, the granular permission
consent screen is not applicable" ([granular
permissions](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions)).
Google lists it as restricted ([Gmail
scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)), which brings the checks and
limits below. Nothing narrower does the job: `gmail.metadata` can't fetch a whole email
([messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)),
and the `gmail.messages.readonly` in the [discovery
document](https://gmail.googleapis.com/$discovery/rest?version=v1) (revision 20261116) isn't
accepted by `users.watch`, `users.stop` or `users.getProfile`, and isn't in the scopes guide:
Google's own pages disagree.

The page's nine points (`src/config/gmail-disclosure.ts`), which each person agrees to, say what
Jane reads, what Claude is sent and what's kept. For the team:

- **What's kept**: per money email (`gmail_readings`), Gmail's id, when it arrived, the sender's
  domain, the kind, the amount and the day; per mailbox (`gmail_mailboxes`), the address, the words
  agreed to and when, the place reading has reached, and the tokens, encrypted with
  `TOKEN_ENCRYPTION_KEY`. **Who sees it**: only the person, on `/settings/mailboxes` (the newest 50)
  and in Download my data (all but the tokens and the place). No card, chat, alert, email or team
  page uses it. The address is never in a log, an audit record, a job, a rate-limit key or an ops
  event.
- **When it reads**: Google's notice of new inbox mail ([Gmail push
  notifications](https://developers.google.com/workspace/gmail/api/guides/push)) reaches
  `/api/gmail/webhook`, which checks Google's signed token, answers, and reads on from the saved
  place; connecting starts a first read. Either read has 150 seconds from when its request arrived,
  and 60 emails (`GMAIL_LIMITS`), counted between history records: one record that names more is
  read to its end while time is left. Mail a read doesn't reach leaves `unfinished` for the next
  notice or the daily job. Every call goes only to Google's own addresses (`googleAddressAllowed`),
  never follows a redirect, and gives up on a try after 8 seconds. Connecting a mailbox again, or
  rotating `TOKEN_ENCRYPTION_KEY`, stops a read under way.
- **One Jane account per mailbox**: connecting an address another account holds moves it. The
  earlier account's tokens are wiped, its read stops, its page says so, and its readings stay until
  it disconnects. The audit log has the system's `gmail_taken_over` under the earlier mailbox, and
  `took_over` on the new holder's `gmail_connected`.
- **Removal** (Disconnect, inactivity, account deletion) deletes the mailbox and its readings, then,
  if it held tokens, asks Google once to end the permission, only when no other active mailbox holds
  the address (checked again right before), as at Google that ends every permission the project
  holds for the account (setup step 1). When Jane can't tell, it doesn't ask, and after a Disconnect
  the page says Google didn't confirm, as when Google doesn't answer. It works switched off or
  paused.

## Set up Google Cloud

You need the founders' shared Google account and the site's address as Jane knows it (`APP_URL` in
Vercel). Keep a note: four values go into Vercel after step 7. The client secret never goes in it.

### 1. A project of its own

At <https://console.cloud.google.com/>, signed in with the founders' shared Google account, open the
project picker, **New project**, name it "Jane Gmail", create it and choose it: every step below
happens inside it. Note its **Project ID** (on its **Dashboard**, or in the picker's list) for step
5; it can differ from the name.

**Never use the "Jane" project from `docs/setup/google-sign-in.md`**, or one with any other client:
at Google a permission belongs to the project. "Revocation removes all OAuth 2.0 scopes previously
granted to a project, invalidating any issued access or refresh tokens for all clients registered
under that project" ([revoking a
token](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)), so a
Disconnect would also end that person's "Continue with Google". A person's grants to a project
combine, whichever client asked ([incremental
authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth)).
The cap of 100 people (step 3) is the project's for its whole life. Gmail's topic must be in the
project that asks for notices ([Gmail push
notifications](https://developers.google.com/workspace/gmail/api/guides/push)). Development and
staging get projects of their own, sparing production's 100; Google's OAuth pages also say to make a
separate project for each deployment tier (the notes this guide was checked against don't record
which page).

### 2. Turn on the Gmail and Pub/Sub APIs

In **APIs & Services → Library**, search for "Gmail API", open it and click **Enable**; then the
same for "Cloud Pub/Sub API". If the console asks for a billing account first, link the founders'
one (the notes this guide follows don't cover billing). The [Gmail API
quota](https://developers.google.com/workspace/gmail/api/reference/quota) page sets a daily billing
threshold of 80,000,000 units per project ("You can't request an increase on this daily threshold
limit."), about 16,000 of Jane's largest reads, and plans charges for going over the quota "later in
2026".

### 3. The consent screen

Open **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**). If it
isn't set up, **Get started** asks for the first few of these; the rest are on the pages named:

- **Branding**: App name **Jane**; user support email and developer contact, the founders' address;
  no logo; home page `https://your-domain`, privacy policy `https://your-domain/privacy`, terms of
  service `https://your-domain/terms`; authorized domain `your-domain`. **Save**.
- **Audience**: User type **External**, left at **Testing**; under **Test users → Add users**, the
  Gmail address for the founder's test, which publishes the app once it passes.
- **Data Access**: **Add or remove scopes**, filter for `gmail.readonly`, tick
  `.../auth/gmail.readonly`, **Update**, **Save**. Nothing else: scopes in the code that differ from
  these bring an "unverified app" screen ([unverified
  apps](https://support.google.com/cloud/answer/7454865)).

In Testing only the listed test users (up to 100) can grant access, and each grant expires seven
days after it's given, refresh token included
([audience](https://support.google.com/cloud/answer/15549945), unverified apps): a mailbox then says
"Google stopped accepting this connection". Testing is for the founder's test only. In production
but not verified, Google's page warns people first, and the project can take "100 new users in
total, after the app presents the unverified app screen". "The user cap applies over the entire
lifetime of the project, and it cannot be reset or changed." (unverified apps). Jane's page warns
people too while `GMAIL_APP_VERIFIED` is false.

### 4. The OAuth client

1. **Google Auth Platform → Clients → Create client** (older: **APIs & Services → Credentials →
   Create credentials → OAuth client ID**): **Web application**, "Jane Gmail web", no **Authorized
   JavaScript origins**.
2. **Authorized redirect URIs → Add URI**: the site's address and `/api/gmail/callback`, like
   `https://your-domain/api/gmail/callback`, with the address exactly as `APP_URL` has it (https,
   the same spelling with or without `www`, no extra slash): Jane sends exactly that. With `APP_URL`
   empty, Jane uses Vercel's `VERCEL_PROJECT_PRODUCTION_URL`; set `APP_URL` instead.
3. Leave **Use this client for an AI-powered agent** unticked if it's there (Open questions).
4. **Create**, and copy the **Client ID** into your note. With the box still open, add
   `GMAIL_CLIENT_SECRET` for **Production** in the Jane project in Vercel (**Settings → Environment
   Variables**), the Client secret as its value. Then close the box.

### 5. The topic

1. **Pub/Sub → Topics → Create topic**: ID `gmail-notices`, **Add a default subscription** unticked
   (step 7 makes Jane's), **Create**.
2. Copy its full **Topic name**, `projects/<project-id>/topics/gmail-notices`, into your note.
3. Back on **Pub/Sub → Topics**, tick it, and in the panel on the right (**Show info panel** if it's
   hidden) open **Permissions → Add principal**: `gmail-api-push@system.gserviceaccount.com`, role
   **Pub/Sub Publisher**, **Save**.

Gmail's guide asks only to "grant publish privileges" and names no role (Gmail push notifications);
Pub/Sub's [access control](https://docs.cloud.google.com/pubsub/docs/access-control) page says the
Publisher role (`roles/pubsub.publisher`) includes them. Domain-restricted sharing in a company's
Google organization can refuse the grant (the Gmail guide).

### 6. The service account that signs the notices

**IAM & Admin → Service Accounts → Create service account**: "jane-gmail-push", **Create and
continue**, skip the steps that grant roles, **Done**. Copy its email, as the list shows it, into
your note: it's the email claim of the token Pub/Sub signs each notice with ([creating a push
subscription](https://docs.cloud.google.com/pubsub/docs/create-push-subscription)), and Jane takes a
notice only when that is `GMAIL_PUSH_SERVICE_ACCOUNT`.

### 7. The push subscription

First, with the address from step 4, this must print `404` while `GMAIL_LINK` is empty:
`curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST https://your-domain/api/gmail/webhook`
A 300s status and another address is Vercel redirecting (to `www.your-domain`, say): check that one
and use whichever prints `404`. Pub/Sub takes only 102, 200, 201, 202 or 204 as an acknowledgment
([push](https://docs.cloud.google.com/pubsub/docs/push)), so behind a redirect no notice arrives.
Then **Pub/Sub → Subscriptions → Create subscription**:

| Setting | Value |
| --- | --- |
| Subscription ID | `gmail-notices-push` |
| Select a Cloud Pub/Sub topic | the topic from step 5 |
| Delivery type | **Push** |
| Endpoint URL | `https://your-domain/api/gmail/webhook`, at the address checked above |
| Enable payload unwrapping | **off** |
| Enable authentication | **on**, with the service account from step 6 |
| Audience | the endpoint URL again, typed exactly: `https://your-domain/api/gmail/webhook` |
| Expiration period | **Never expire** |
| Acknowledgement deadline | **60** seconds |
| Everything else | as it comes |

- **Unwrapping** delivers the message data directly as the HTTP body ([payload
  unwrapping](https://docs.cloud.google.com/pubsub/docs/payload-unwrapping)); Jane reads
  `message.data` inside the wrapping, so it would drop every notice and read mailboxes once a day.
- **The audience** is `GMAIL_PUSH_AUDIENCE`; left empty, it's the endpoint URL ([subscriptions
  reference](https://docs.cloud.google.com/pubsub/docs/reference/rest/v1/projects.subscriptions)).
  The reference calls it case-sensitive, the [push subscription
  guide](https://docs.cloud.google.com/pubsub/docs/create-push-subscription) case-insensitive: Jane
  compares it exactly, so copy it character for character.
- **Tokens on push requests may be up to an hour old** ([authenticating
  push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)), so Jane doesn't
  refuse one for its age.
- **Never expire**: unset, a subscription expires after 31 days without activity (subscriptions
  reference), and a quiet month (nobody connected, or reading paused) would end every notice.
- **60 seconds**: unset it's 10 (10 to 600), and for push it's also the request's timeout. Jane
  answers before it reads, but a function just woken may first fetch Google's keys (up to 8
  seconds). A refusal or a missed deadline means a resend, and refusals slow the whole subscription,
  by 100 milliseconds to 60 seconds (push, and [subscription
  properties](https://docs.cloud.google.com/pubsub/docs/subscription-properties)). Left as it comes,
  an unacknowledged notice is tried again until it's 7 days old.

## Add them to Vercel

In the Jane project, **Settings → Environment Variables**, for **Production** only:

| Name | Value |
| --- | --- |
| `GMAIL_CLIENT_ID` | the Client ID (setup step 4) |
| `GMAIL_CLIENT_SECRET` | the Client secret, added already in setup step 4 |
| `GMAIL_PUBSUB_TOPIC` | the full topic name, `projects/<project-id>/topics/gmail-notices` (setup step 5) |
| `GMAIL_PUSH_AUDIENCE` | the Audience, exactly as typed (setup step 7) |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | the service account's email (setup step 6) |

Leave `GMAIL_LINK` empty until the founder's test, and `ANTHROPIC_GMAIL_MODEL` empty (the reader
then uses `claude-haiku-5-5`; another model is used only if it has a listed price). Never set
`GMAIL_API_URL` here: it's for tests, and production ignores it. Jane also uses `APP_URL`,
`TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY` and `CRON_SECRET`, which production has. Variables take
effect on the next deployment: the deploy loop's next, or **Deployments → the current production
deployment → ⋯ → Redeploy** (`docs/incident.md`). The client secret goes nowhere else.

## The daily job

`/api/cron/gmail` runs at 11:15 UTC (`vercel.json`). Off (`GMAIL_LINK` empty, or `KILL_BANKS` on),
it reads nothing and answers `{ "off": true }`, its run recorded with no summary. On, the whole run
has 165 seconds (`refreshAllGmail` in `src/lib/gmail/sync.ts`), for each active mailbox that isn't
waiting to be tried again and is due: not read through in 20 hours, with a code left by its last
read (a failure, Claude's, `unfinished` or a failed watch), or with notices to ask for again.

- Mailboxes never read through go first, the one left waiting longest first; then the rest, the
  oldest checked first.
- One never read through gets a whole read's 150 seconds; once another mailbox has started, it waits
  for the next run if less than that is left.
- One whose last read was `unfinished` gets 150 seconds when that much is left, and 20 otherwise.
- Any other gets 20 seconds. Those the run doesn't reach wait for the next one.

Its summary counts `read`, `waiting` (Claude couldn't be asked), `failed`, `reconnect` and
`deferred` (no time left); in Neon's SQL editor,
`SELECT started_at, summary FROM cron_runs WHERE name = 'gmail' ORDER BY started_at DESC LIMIT 7;`.
With `HEALTHCHECKS_PING_KEY` set, the first run makes a Healthchecks check `jane-gmail`, with a
period Healthchecks doesn't state (`docs/security/vendors.md`): set 1 day, and an hour or two of
grace. A day without a good run also sends the missed-job email (`src/lib/health.ts`).

## What must be true before switching on

All of these, in writing where it applies:

1. **Counsel's read** of the Gmail paragraphs of the Privacy Policy and the Terms, which show only
   while `GMAIL_LINK=1` (on a local run, or in `src/app/privacy/page.tsx` and
   `src/app/terms/page.tsx`), and of Google's rules (Limits). The questions are in
   `docs/legal/README.md`. Google's consent screen links to the Privacy Policy.
2. **Anthropic's terms on file**: on training on what Jane sends, keeping it, and who there may read
   it. For each email that passes the screen, Claude gets the day it arrived, the sender's domain,
   at most 300 characters of subject and the text's first 2,500 and last 1,500, with links, email
   addresses and long numbers taken out; never an email carrying a sign-in code, a password or a
   code to approve a payment (`src/lib/gmail/text.ts`). Google's pages don't address an outside AI
   provider in those words; by their text it's passing data to another company, allowed only for the
   feature people see and "only with the user's consent", and never for "Transferring, selling, or
   using user data to create, train, or improve a machine learning or artificial intelligence model
   beyond that specific user's personalized model for the appropriate use case or user-facing
   feature." ([Workspace API user data
   policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)). The
   page names Anthropic, and what it's sent, above the Connect link.
3. **Room in Claude's month.** Mail stops for everyone once the month's Claude spend reaches
   `GMAIL_MONTH_SHARE` (half) of `CHAT_MONTHLY_CAP_CENTS` (800 cents unless set: $4 by default),
   until the month turns (UTC); a mailbox already read then says "Jane isn't reading new email right
   now. It will carry on by itself." A short wait loses nothing; over about a week can (Turning it
   off). Watch `waiting` in the daily job's summary.
4. **The team's rule, as `/privacy` promises**: nobody opens rows of `gmail_mailboxes` or
   `gmail_readings` (in Neon, a backup or a script) unless the person asked, to fix a bug or a
   security problem, or because the law requires it; otherwise counts only, or the user ids a step
   in this guide needs, never an address or a reading. The founder's test uses your own mailbox.
5. **Google Cloud and Vercel set up** as above, with `GMAIL_LINK` still empty.

Then the founder's test passes.

## The founder's test

Every test uses the fake Google (`src/lib/gmail/__fixtures__/fake-google.ts`), so the first real
connection tests what it assumes, some of which Google doesn't promise: that the metadata answer has
when an email arrived and its first line (the documented contract is the id, labels and headers:
[messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[Format](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format)); the form of
Google's Authentication-Results header, which no Google page specifies ([email
headers](https://support.google.com/mail/answer/180707)); and that Google's token address takes PKCE
from a web client, which Jane sends, though the [web server
guide](https://developers.google.com/identity/protocols/oauth2/web-server) doesn't mention it and
Google documents it only for [installed
apps](https://developers.google.com/identity/protocols/oauth2/native-app).

Run it on the live site while the consent screen says Testing, so only your test user gets past
Google's page, with your own Jane account (a real bank, or none: one whose only bank is the demo
bank can't connect) and your test user's mailbox, with a few receipts or bills from the last 14
days.

1. **Switch on**: in Vercel set `GMAIL_LINK` to `1` for Production, and redeploy. Everyone signed in
   now sees mailboxes in Settings, though nobody else gets past Google's page: do the rest at once.
2. **The page**: in **Settings**, under **Banks and files**, **Gmail mailboxes** says "None" and has
   a **Mailboxes** link (or go to `/settings/mailboxes`). The page says "You're signed in to Jane
   as" and your email, then **Before you connect** with nine points, the last "Google hasn't checked
   Jane yet, so its page shows a warning first. That's expected during the beta.", then "By
   connecting, you agree to Jane reading this mailbox as described above." and **Agree and connect a
   Gmail mailbox**. "Connecting isn't set up yet." means `GMAIL_CLIENT_ID` or `GMAIL_CLIENT_SECRET`
   is missing.
3. **Google's pages**: click it, pick the mailbox, go past Google's warning that it hasn't verified
   the app (perhaps under **Advanced**), and write down Google's exact words for what Jane may do.
   Jane's second point promises "view your email messages and settings": if Google's differ, change
   it in `src/config/gmail-disclosure.ts`, with a new `GMAIL_DISCLOSURE_VERSION`, before anyone else
   connects. Then allow it.
4. **Back on Jane**: "Connected." and, under the mailbox, "Reading your newest emails from the last
   14 days. This takes a minute or two. Come back to this page to see what Jane read."
   - "That mailbox wasn't connected": if Google's side failed, Vercel's logs have
     `Gmail sign-in didn't finish` with a code. `client`: Google turned Jane's client away (check
     `GMAIL_CLIENT_SECRET`). `grant`: the code was used, too old, or not from this sign-in.
     `no_refresh`: no refresh token. `http_` and a status, or `signed_out`: Gmail refused the first
     call (is the Gmail API on?). Google not taking PKCE may show as `grant`, or `token_http_` and a
     status. Anything else (`timeout`, `unreachable`): try again. With no such line, the code is in
     the audit log (Neon's SQL editor, production branch):
     `SELECT created_at, metadata->>'code' FROM audit_log WHERE event = 'gmail_connect_failed' ORDER BY created_at DESC LIMIT 5;`
     `state`: a sign-in this browser didn't start, or over 10 minutes on Google's page. `denied`:
     Cancel on Google's page. `no_code`: Google came back without one. `refused`: an account that
     can't connect (a sample, or one whose only bank is the demo bank). `save`: the database didn't
     save it (logged as `Gmail mailbox wasn't saved`).
   - "Google didn't give Jane permission to read that mailbox": no `gmail.readonly` in Google's
     answer; check the scope (setup step 3).
   - An error on Google's own page: compare the redirect URI with `APP_URL`, letter for letter.
5. **A few minutes later**: "Reading new email as it arrives. Last checked" and a time, and **Money
   emails Jane read** lists emails from the last 14 days.
   - "Reading new email once a day": Google refused the request for notices (logs:
     `Gmail notices not renewed` and a code; `/admin/health`: "Gmail reads failed"). Check
     `GMAIL_PUBSUB_TOPIC`, the topic's project, and the Publisher grant (setup step 5).
   - "Jane has read part of this mailbox and will read the rest by itself." (it saved some) or "Jane
     hasn't been able to read this mailbox yet. It will try again by itself." (none): the first read
     stopped, and the next notice or the daily job goes on. The logs have `Gmail read failed` and a
     code, or `Gmail read stopped: Claude couldn't be asked` and a reason (Claude gets one try per
     email; the mailbox then waits 30 minutes), or `Gmail read` if it ran out of time. With none of
     these, Claude can't be asked: no `ANTHROPIC_API_KEY`, `KILL_CLAUDE` on, the month's half used,
     or your own allowance used up. The first-read line shows only for 10 minutes after connecting,
     while nothing has stopped that read and Claude can be asked.
   - Once read through, "Jane isn't reading new email right now" is Claude not being askable, and
     "The last read didn't work" is `Gmail read failed`, or
     `Gmail read stopped: Claude couldn't be asked`, in the logs.
6. **The counts**: the log line `Gmail read` has `kept`, `none` and `skipped` by reason. Many
   `no_date`: the metadata answer has no `internalDate`, so nothing will ever be listed; stop (see
   the end) and fix `src/lib/gmail/message.ts`. Nearly all `unverified`: Google's header doesn't
   read as `message.ts` expects; compare a receipt's `Authentication-Results: mx.google.com; ...`
   (in Gmail, **⋮ → Show original**) with what `dmarcPass` reads. `label`, `personal`, `security`,
   `no_money`: the screen at work.
7. **What's listed**: check each against its email (domain, kind, amount, day). Expect a few misses,
   the check being rough, and nothing from the services on `PERSONAL_MAIL_DOMAINS`, no sign-in codes
   and no promotions. Then check that the screen sees an email's first line: find a receipt or bill
   outside Promotions, Social and Forums with no amount or money word in its subject (`MONEY_SIGNS`
   in `src/lib/gmail/screen.ts`), but the amount in its first line as the inbox shows it. It should
   be listed. If such emails never are while others are, the metadata answer has no first line and
   they count as `no_money`: stop, as for `no_date`, and fix that.
8. **A new receipt within a minute**: buy something small from a company that emails receipts, or
   wait for a real bill; within a minute of reaching the inbox it's listed. Only the next day means
   notices don't reach Jane. "Gmail notices refused (not signed by Google for us)" on
   `/admin/health`: authentication is off, or the audience or service account isn't exactly
   `GMAIL_PUSH_AUDIENCE` or `GMAIL_PUSH_SERVICE_ACCOUNT`. The log line
   `Gmail notice not understood`: unwrapping is on. Neither: check the subscription's topic (step
   5's) and endpoint (the one checked in step 7).
9. **A forged header isn't trusted**: send your mailbox an email from a company's address with a
   money subject like "Your receipt: $12.34" and a header the sender wrote:
   `Authentication-Results: mx.google.com; dmarc=pass header.from=<the sending domain>`. Resend,
   which Jane sends with, takes added headers in its API's `headers` field (`src/lib/email.ts` uses
   it), as do most mail tools. Bcc a mailbox outside Google (iCloud, Outlook or the like). Filed
   under Promotions, it proves nothing: send it again. Then in Gmail, **⋮ → Show original**:
   - Your header is there: the email must not be listed (two headers in Google's name: Jane trusts
     neither), and `Gmail read` counts it `unverified`. Listed: stop and switch off.
   - It's gone: if the other mailbox's copy has it, Gmail removes such copies, which Google's pages
     don't say either way (email headers): note it here. The email is then judged by Google's header
     alone. If that copy lost it too, the sending tool dropped it: send it another way.
10. **Nothing kept that shouldn't be**: search Vercel's logs for your address and for a word from
    one listed email's subject that isn't the sender's name or a kind (receipt, bill, renewal,
    price, refund), such as a product's name: neither is there. Search the database for that word:
    nothing has it. The domain and kind are kept.
11. **Publish**: **Google Auth Platform → Audience → Publish app**, and confirm. It should say **In
    production**. If Google offers to start verifying the app, that can wait (Limits).
12. **Disconnect**: open **Disconnect** on the mailbox and click **Yes, disconnect**. The page says
    "Disconnected. Jane deleted what it read from that mailbox, and Google ended Jane's permission."
    Your Google Account then stops listing Jane, perhaps not at once: a revocation may take some
    time to have full effect (revoking a token).
13. **Connect again**: check the warning and the permission's words, now everyone's. This permission
    doesn't end after a week, as Testing's did.
14. **An hour later**, after a new email, "Last checked" has moved on: token renewal works.
15. **The next day**: the daily job has run (its summary), and Healthchecks has `jane-gmail`: set
    its period.
16. **A week later** the mailbox still says "Reading new email as it arrives": Jane renewed its
    request, as `watch` must be called at least every 7 days or notices stop (Gmail push
    notifications).

If a step before 11 fails, disconnect, empty `GMAIL_LINK` and redeploy; the subscription can stay.
In Testing, nobody else could have connected.

## Turning it off

**To pause, set `KILL_BANKS`** (`docs/incident.md`); the banks pause too. Nothing is read or
connects: the page says "Reading is paused for now. Jane isn't reading any mailbox. You can still
disconnect." to someone with a mailbox, and "Connecting is paused for now. Please try again later."
to anyone else and to a sign-in back from Google's page. Notices are still checked and answered,
reading nothing; the daily job answers `{ "off": true }`; disconnecting and deleting an account
work. Over about a week costs mail: nothing renews the request for notices, and a history id is
typically valid for at least a week, in rare cases only a few hours
([history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)).
A mailbox that lost its place skips ahead, reads its newest 30 emails of 14 days, and says "Jane
couldn't read this mailbox for a while, so some emails before" that day "weren't read."

**To switch off for good**, in this order:

1. **Remove every mailbox**: ask people to disconnect, or remove each person's with
   `removeAllMailboxes` (`src/lib/gmail/mailbox.ts`), for each id
   `SELECT DISTINCT user_id FROM gmail_mailboxes;` gives, with the reason `user_disconnected` (none
   names switching off) and `actor: { type: "admin", id: <your user id> }`. It deletes what was read
   and asks Google to end each permission, without reporting which ones Google didn't confirm; each
   `gmail_disconnected` audit record has it (`ended_at_google`), and where that's false the person
   can remove Jane in their Google Account. The legal pages stop mentioning mailboxes once the
   switch is off, so one left would be data they don't describe, with Jane's permission standing at
   Google.
2. **Delete the push subscription** (**Pub/Sub → Subscriptions**, tick it, **Delete**). Google may
   send notices up to 7 days after a mailbox's last renewal, and doesn't say whether ending a
   permission stops them ([Gmail push
   notifications](https://developers.google.com/workspace/gmail/api/guides/push)); once step 3
   switches it off, the webhook answers 404, which isn't an acknowledgment, so Pub/Sub would resend
   each notice for 7 days by default, slowing the subscription
   ([push](https://docs.cloud.google.com/pubsub/docs/push)). With no subscription, nothing is sent.
3. **Empty `GMAIL_LINK`** and redeploy: no Connect link, the connect, callback and webhook routes
   answer 404, and the daily job reads nothing. A mailbox left shows "Mailboxes are switched off for
   now. Jane isn't reading this mailbox. Disconnect to delete what Jane read from it." and can be
   disconnected; account deletion and the inactivity clean-up still remove mailboxes.
4. **Check none is left** (until step 3 anyone could connect one): on the production branch,
   `SELECT count(*) FROM gmail_mailboxes;` must say 0. Remove any as in step 1: `removeAllMailboxes`
   works switched off.

## The way back

Google is told `<site>/api/gmail/callback` (`GMAIL_CALLBACK_PATH`: keep it, it's registered in the
client), `<site>` being `APP_URL`, else Vercel's production address, else `AUTH_URL`'s
(`callbackOrigin` in `src/lib/gmail/oauth.ts`); on a laptop with none, the address the site is
opened at, and in production with none the Connect link answers "Connecting isn't set up yet." If
the site's address changes, first add `<new site>/api/gmail/callback` to the client's **Authorized
redirect URIs**, then change `APP_URL`, then the subscription's endpoint (**Pub/Sub → Subscriptions
→** it **→ Edit**) and the consent screen's links and domain. The audience can stay while
`GMAIL_PUSH_AUDIENCE` matches it.

## Tests and local runs

Tests use the fake Google on a local port through `GMAIL_API_URL`, honored only for `localhost`,
`127.0.0.1` or `[::1]` and never when `VERCEL_ENV` is `production`, so no setting can send a
person's tokens or mail elsewhere. `npx vitest run src/lib/gmail` runs the unit tests, and with
`TEST_DATABASE_URL` the integration tests; the page, Disconnect, the job's route and the legal words
have tests beside them. There's no browser spec, on purpose (off by default; Google's pages can't be
driven): `src/lib/gmail/routes.integration.test.ts` drives the routes.

On a laptop against the real Google, use a development project of its own set up as above, with your
local address and `/api/gmail/callback` as the redirect URI, and `GMAIL_PUBSUB_TOPIC` empty (Google
can't send notices to a laptop). Connecting reads a mailbox (connect again for what came since), and
so does the daily job, for the mailboxes due a read (The daily job, above):
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/gmail`. Leave the topic
empty only there: in production the job would be the only reader, one read a mailbox a day (about 60
emails), which a busy mailbox outgrows.

## Limits

- **100 people in all, for the project's whole life, while Google hasn't verified the app** (setup
  step 3).
- **Before a public launch**, Google's verification of the app, which for a restricted scope
  includes a security assessment, "If you store restricted scope data on servers (or transmit), then
  you must go through a security assessment.", and then again: "apps must be reverified for
  compliance and complete a security assessment at least every 12 months after your assessor's
  Letter of Assessment (LOA) approval date" ([restricted scope
  verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
  Once verified, set `GMAIL_APP_VERIFIED` to `true` in `src/config/gmail.ts`: the page's warning
  goes, so `GMAIL_DISCLOSURE_VERSION` must change too (its test fails until it does).
- **Google's rules for the data, "Limited Use"** ([Workspace API user data
  policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), updated
  2026-09-03; the general [API Services User Data
  Policy](https://developers.google.com/terms/api-services-user-data-policy), last updated February
  15, 2024, has the same four rules, without the line on AI models and with slightly different
  exceptions for people reading data). Use is limited to "providing or improving your appropriate
  use case or features that are visible and prominent in the requesting application's user
  interface". Data may go to another company to provide that, "and only with the user's consent" (or
  for security, the law, or a merger). "Do not allow humans to read user data, unless" the person
  consents for specific messages, it's for security or the law, or it's aggregated and anonymized.
  Never for ads, never "to determine credit-worthiness or for lending purposes", and never to train
  an AI model beyond the person's own. Tokens "encrypted at rest", "Protecting against prompt
  injection techniques by either using Google Cloud Platform's Model Armor or other prompt injection
  protection.", and a disclosure in the app that "Cannot be placed only in a privacy policy or terms
  of service" (Jane's is the points above the Connect link). Jane keeps to it by using what it reads
  only for the list on the mailboxes page. Before a chat, a card, a deadline, a team page, a partner
  or a lending feature may read the mail tables, someone has to decide how advice mode and these
  rules apply; lending most, as Jane has loan features and a lender partner.
- **The disclosure sentence.** Google gives three wordings. The policy's: "The use of information
  received from Google Workspace scopes will adhere to the Google User Data Policy, including the
  Limited Use requirements." The verification help's: "{App's} use of information received from
  Google APIs will adhere to Google API Services User Data Policy, including the Limited Use
  requirements." The use-case page's: "The use of raw or derived user data received from Workspace
  APIs will adhere to the Google User Data Policy, including the Limited Use requirements." (Help
  pages [13463817](https://support.google.com/cloud/answer/13463817),
  [13805798](https://support.google.com/cloud/answer/13805798) and
  [13806988](https://support.google.com/cloud/answer/13806988), and the policy above.) `/privacy`
  uses the second, in Jane's words, with the rules above in plain words after it.
- **Quota.** For projects made from 2026-05-01, `messages.get` costs "20 (60 when format is full,
  raw, or html)" units, and one Google account may use 6,000 units a minute in one project (Gmail
  API quota, setup step 2). A read asks for about 60 emails (more only when one history record names
  more), a metadata look each and a full fetch for those that pass: about 4,800 units and a few for
  the listing, under that even in one minute unless one record names many more. Check the project's
  real numbers on the Gmail API's quotas page before a launch.
- **Claude**: 60 emails a day and 600 in 30 days for one person across their mailboxes, and 15 a day
  from one sender (`src/lib/gmail/limits.ts`), inside the person's allowance for Claude's background
  work (`src/lib/claude-budget.ts`), and mail stops for the month at half the cap (before switching
  on, item 3). Reading then waits where it is.
- **Five mailboxes a person** (`mailboxesMost`). The first read takes the newest 30 emails of the
  last 14 days, newest first, as many as it has time for; any left are counted `look_back_cut` in
  its `Gmail read` line, and aren't read later.
- **Google stops accepting a connection** for reasons in its [OAuth
  overview](https://developers.google.com/identity/protocols/oauth2), among them the person taking
  the permission back, "The refresh token has not been used for six months.", and "The user changed
  passwords and the refresh token contains Gmail scopes." The next read wipes the tokens, and the
  page asks the person to connect again.
- **Inactivity**: the clean-up runs inside the banks' daily job (`/api/cron/plaid-sync`), only while
  Plaid is set up and `KILL_BANKS` is off (`plaidEnabled()`): in production, daily unless
  `KILL_BANKS` is on. After 60 days unused, with an email 7 days before, it removes the person's
  mailboxes as Disconnect does.
- **Notices aren't certain**: "in rare situations, notifications might be delayed or dropped" (Gmail
  push notifications). The daily job reads what they missed.

## Known limits

The sender check (`verifiedSender` in `src/lib/gmail/message.ts`) trusts an email only with one From
header holding one address, no `X-Gmail-Fetch-Info`, and exactly one Authentication-Results header
in Google's name (`mx.google.com`) holding exactly one DMARC result, `pass`, for the From address's
own domain: never a parent domain or a DKIM signature alone. The part of that domain a company
registers (`amazon.com`, `example.co.uk`) is what's saved and shown. So:

- **A pass names a domain, not an honest company**: a scammer's domain passes for itself. The page
  says so above the list: "It can't tell whether the email is honest, so if you don't recognize one,
  don't pay or call from it."
- **The mailbox's owner can make any sender look checked**: mail put in through Gmail's API goes in
  "similar to IMAP APPEND, bypassing most scanning and classification"
  ([messages.insert](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/insert)),
  so it may carry a header its writer made up. Only their own page is affected.
- **Google documents neither the header's form nor that it removes a copy the sender wrote** (email
  headers): hence exactly one header in Google's name, in whatever order, and the founder's test.
- **Forwarded mail** from another Gmail mailbox or through Google Groups is expected to carry two
  headers in Google's name (Google doesn't document it), and is skipped; from iCloud, Outlook and
  the like it often fails Google's check: "forwarded messages often fail SPF authentication", and
  "Gmail does its own authentication check on forwarded messages." (Google's
  [forwarding](https://support.google.com/mail/answer/175365) and
  [ARC](https://knowledge.workspace.google.com/admin/security/arc-email-authentication) pages). The
  page tells people some forwarded emails will be missed.
- **Mail Gmail fetched from another mailbox** (with `X-Gmail-Fetch-Info`) is skipped: Jane takes it
  that Google's servers never checked who sent it.
- **DMARC only**: a company whose mail doesn't pass DMARC for its own From domain is never read,
  even with a good DKIM signature.
- **Personal mail** is skipped only from the services on `PERSONAL_MAIL_DOMAINS` (matched exactly):
  an email from a person's own domain can't be told from a company's, so it's read like one, as the
  page's third point says.

And three more. **One history record that takes longer than a whole read** (with notices on, dozens
of money emails Gmail lists together) can still hold a mailbox: each read stops inside it and starts
it again. **An `unfinished` mailbox the daily job reaches with less than 150 seconds left gets 20**,
so while the mailboxes before it take more than 15 seconds every night, a record that takes longer
than 20 seconds holds it until they take less, or a notice reads it. **A sign-in link someone else
sent** can land a person on the mailboxes page of the sender's Jane account, one tap from Google.
The Connect link works only with a ticket made for that browser's own session
(`src/lib/gmail/connect-ticket.ts`), so such a link can't lead straight to Google's page, and the
page names the account above the link ("You're signed in to Jane as"): tell people to check that
name before they connect.

## Open questions for Google

- **Is Jane's reader an "AI-powered agent"?** The console can mark a client "Use this client for an
  AI-powered agent", and an app with both interactive and agent workflows "must create and maintain
  separate OAuth 2.0 client IDs for each workflow" ([AI agent
  clients](https://support.google.com/cloud/answer/15549257)). Jane has one client: a person
  connects, then Jane reads on its own. Ask during verification; until then the box stays unticked.
- **Is Jane's protection against prompt injection enough?** The policy asks for Model Armor "or
  other prompt injection protection" (Limits). Jane's is its own: every request carries
  `UNTRUSTED_TEXT_RULE` (`src/lib/untrusted-text.ts`), and code checks Claude's three answers
  (`src/lib/gmail/read-mail.ts`).
- **Email text going to Anthropic**: see before switching on, item 2.

## When someone asks what Jane reads

Answer from the page's nine points, which are what they agreed to (each mailbox keeps the version
they saw, `disclosure_version`; the current one is `GMAIL_DISCLOSURE_VERSION`). If they ask more:
Jane skips spam, the trash, what they sent, and the Promotions, Social and Forums tabs; it takes out
links, email addresses and long numbers before Claude sees an email; it keeps nothing about emails
it skipped; only they see what it found, in Settings under Mailboxes and in Download my data; and
disconnecting there deletes it all and asks Google to end Jane's permission, or they can remove Jane
in their Google Account.
