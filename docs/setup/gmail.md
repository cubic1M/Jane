# Gmail mailboxes

A person connects one or more of their own Gmail mailboxes, on Google's sign-in page, and Jane lists
the emails in them about their money: bills, receipts, renewals, price changes and refunds. It's
off: `GMAIL_LINK` isn't set anywhere, and until it's exactly `1` there is no Connect link, the
connect, callback and webhook routes answer 404, and nothing is read. Google's side takes about an
hour to set up the first time.

The Google pages linked below were read on 2026-11-18, and every quote was checked word for word
against them. Google moves its menus and rewrites its pages, so open a page before relying on a
line, and use the console's search bar when a menu below has moved. Where Google's pages disagree,
or say nothing, this page says so.

## What Jane reads

### One permission, read-only

Jane asks Google for `https://www.googleapis.com/auth/gmail.readonly` and nothing else
(`GMAIL_SCOPE` in `src/config/gmail.ts`). Asked for alone, it comes with no box to untick: "For
applications that request only one non-Sign-In scope, the granular permission consent screen is not
applicable" ([granular
permissions](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions)).
The way back still checks that Google's answer grants it, and connects nothing if it doesn't.

Google lists `gmail.readonly` as a restricted scope ([Gmail
scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)), which is what brings the
checks and limits below. Nothing narrower does the job. `gmail.metadata` can't fetch a whole email
([messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)).
Google's discovery document lists a `gmail.messages.readonly` that reads messages but isn't accepted
by `users.watch`, `users.stop` or `users.getProfile` ([discovery
document](https://gmail.googleapis.com/$discovery/rest?version=v1), revision 20261116), and Google's
scopes guide doesn't list it at all: Google's own pages disagree.

Every call Jane makes is in `src/lib/gmail/api.ts`, `oauth.ts` and `webhook-verify.ts`. Each goes
only to one of Google's own addresses (`googleAddressAllowed` in `src/config/gmail.ts`), never
follows a redirect, and gives up on a try after 10 seconds.

| Call | What Jane reads or does |
| --- | --- |
| `users.getProfile` | the mailbox's address and its place in its history: when it's connected, and after a gap |
| `users.watch`, `users.stop` | asks Google to send word when mail reaches the inbox, and to stop. Nothing in the mailbox changes |
| `users.history.list` | which emails arrived since the saved place: their ids, and their labels when Google gives them |
| `users.messages.list` | the ids of the newest 30 emails of the last 14 days, leaving out promotions, social, forums, sent and drafts: for the first read, and after a gap |
| `users.messages.get` (metadata) | From, Subject, Authentication-Results and X-Gmail-Fetch-Info, the first line or two, the labels, when it arrived and its size |
| `users.messages.get` (full) | the whole email, only for one that passed the screen below. Attachments are never read |
| `oauth2.googleapis.com` `/token` and `/revoke` | the sign-in, a new access token when the last one runs out, and ending the permission |
| `www.googleapis.com/oauth2/v3/certs` | Google's public keys, to check its notices |

### What it does with what it reads

- **The screen** (`src/lib/gmail/screen.ts`) decides from the metadata alone, before any body is
  fetched. An email is passed over when it has one of the labels in `SKIPPED_LABELS` (spam, the
  trash, drafts, sent mail, chats, and the Promotions, Social and Forums tabs); when Google's own
  check doesn't vouch for its sender (next point); when it comes from a personal address
  (`PERSONAL_MAIL_DOMAINS`: gmail.com, icloud.com and the like, matched exactly); when its subject
  looks like a sign-in code, a password reset, a sign-in link or an address confirmation; and when
  neither its subject nor its first lines hold a dollar amount or a money word (receipt, invoice,
  refund, statement, bill, payment, renew, "your order", "due date" and a few more). The check is
  rough on purpose: an email it lets through that isn't about money costs one reading that keeps
  nothing.
- **The sender check** (`verifiedSender` in `src/lib/gmail/message.ts`). All of these must hold: one
  From header with one address; no `X-Gmail-Fetch-Info` header (Gmail fetched the email from another
  mailbox); exactly one Authentication-Results header in Google's name (`mx.google.com`); and in it
  exactly one DMARC result, `pass`, for the From address's own domain. Never a parent domain, and
  never a DKIM signature alone. What's saved and shown is the part of that domain a company
  registers (`amazon.com`, `example.co.uk`). Its limits are below.
- **Claude reads what passes** (`src/lib/gmail/read-mail.ts`), with `claude-haiku-5-5` unless
  `ANTHROPIC_GMAIL_MODEL` names another model with a listed price. It's sent the day the email
  arrived, the sender's domain, and the subject and text with links, email addresses and long
  numbers taken out: at most the subject's first 300 characters, and the text's first 2,500 and last
  1,500. An email that carries a sign-in code or a password is never sent (`carriesSecret` in
  `src/lib/gmail/text.ts`). Claude answers with three fields, and code checks each, so nothing
  depends on Claude having listened: the kind must be one on the list, the amount must be a figure
  written in the email and not in another currency, and the day must fall between 60 days before and
  400 days after the email arrived.
- **What's kept.** For each money email (`gmail_readings`): Gmail's id for it, when it arrived, the
  sender's domain, the kind, the amount in cents and the day. No text from the email, and nothing
  about emails passed over or judged not about money. For each mailbox (`gmail_mailboxes`): its
  address, which words the person agreed to and when, the place reading has reached, and the access
  and refresh tokens, encrypted together with `TOKEN_ENCRYPTION_KEY` (`src/lib/gmail/secrets.ts`)
  and never logged or shown.
- **Who sees it.** The person, on `/settings/mailboxes` (the newest 50) and in Download my data
  (everything but the tokens and the place). No card, chat, alert, email or team page uses it. The
  mailbox's address is never in a log, an audit record, a job, a rate-limit key or an ops event.
- **When it reads.** When mail reaches the inbox, Google sends a notice to `/api/gmail/webhook`
  ([Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)), which
  checks Google's signed token, answers at once, and then reads that mailbox from where it last
  stopped. Connecting starts a first read straight away. The daily job (below) is the backstop for
  notices that don't come, and the only reader when notices are off. One mailbox is read by one read
  at a time.
- **Limits on Claude** (`src/lib/gmail/limits.ts`, `src/config/rate-limits.ts`): 60 emails a day and
  600 in 30 days for one person, across their mailboxes, and 15 a day from one sender. Each person's
  own allowance for Claude's background work applies too (`src/lib/claude-budget.ts`). And mail
  stops for everyone once the month's Claude spend passes half the month's cap
  (`GMAIL_MONTH_SHARE`), so mail can't use up what the chat needs. Reading then waits where it is.
- **One Jane account per mailbox.** Connecting an address another Jane account holds moves it to the
  newest sign-in: the earlier account's tokens are wiped, its page says the mailbox is now connected
  elsewhere, and what it read stays until it disconnects.
- **Disconnect, inactivity and account deletion** delete the mailbox and everything read through it,
  and then ask Google to end the permission, but only when no other active mailbox row holds that
  address: at Google, ending one permission ends every permission the project holds for that account
  (setup step 1). Disconnecting works with the switch off and while reading is paused.
- **When Google stops accepting a connection**, Jane finds out at the next read: the tokens are
  wiped, and the page asks the person to connect again. Google's [OAuth
  overview](https://developers.google.com/identity/protocols/oauth2) lists why a refresh token stops
  working, among them the person taking the permission back, "The refresh token has not been used
  for six months.", and "The user changed passwords and the refresh token contains Gmail scopes."
- **`KILL_BANKS`** pauses reading and new connections. Disconnecting keeps working (Turning it off,
  below).

## Set up Google Cloud

You need the founders' shared Google account and the site's address as Jane knows it (`APP_URL` in
Vercel). Keep a note as you go: four of its values go into Vercel after step 7. The client secret
never goes in it: it goes straight into Vercel, in step 4.

### 1. A project of its own

1. Go to <https://console.cloud.google.com/> and sign in with the founders' shared Google account.
2. Click the project picker at the top, then **New project**. Name it "Jane Gmail" and create it.
   Then choose it in the project picker: every step below happens inside it.
3. Write down its **Project ID** (on the project's **Dashboard**, or in the picker's list). It goes
   in the topic's name in step 5, and can differ from the project's name.

**Never use the "Jane" project from `docs/setup/google-sign-in.md`**, or any project another client
lives in. At Google a permission belongs to the project, not to one client:

- "Revocation removes all OAuth 2.0 scopes previously granted to a project, invalidating any issued
  access or refresh tokens for all clients registered under that project" ([revoking a
  token](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)). In a
  shared project, a person who disconnects a mailbox would also lose their "Continue with Google"
  permission, and Jane's rule for when to end a permission (`heldByAnyone` in
  `src/lib/gmail/mailbox.ts`) only knows about mailboxes.
- "The combined authorization includes all scopes that the user granted to the API project even if
  the grants were requested from different clients" ([incremental
  authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth)).
- The cap of 100 people (step 3) is the project's, for its whole life.
- The topic Gmail sends notices to must be in the same project as the client: its project "must
  exactly match your Google developer project id (the one executing this watch request)" ([Gmail
  push notifications](https://developers.google.com/workspace/gmail/api/guides/push)).

For the same reasons, development and staging get projects of their own, so they never use up any of
production's 100 people. Google's OAuth pages also say "you must create separate projects in the
Google Cloud Console for each deployment tier, such as development, staging, and production" (the
notes this guide was checked against don't record which page).

### 2. Turn on the Gmail and Pub/Sub APIs

1. Open **APIs & Services → Library**. Search for "Gmail API", open it and click **Enable**.
2. Back in the Library, search for "Cloud Pub/Sub API", open it and click **Enable**.

If the console asks you to link a billing account before Pub/Sub works, link the founders' one. The
notes this guide follows don't cover Google Cloud's billing. Google's quota page sets a daily
billing threshold of 80,000,000 units per project ("You can't request an increase on this daily
threshold limit."), about 16,000 of Jane's largest reads (Limits, below). It also says:
"Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account
later in 2026." ([Gmail API
quota](https://developers.google.com/workspace/gmail/api/reference/quota)).

### 3. The consent screen

Open **Google Auth Platform** (in older consoles, **APIs & Services → OAuth consent screen**). If it
says it isn't set up yet, click **Get started**: it asks for the first few of these, and the rest
are on the pages named.

- **Branding**: App name **Jane**. User support email and developer contact: the founders' address.
  App logo: none. Application home page `https://your-domain`, privacy policy link
  `https://your-domain/privacy`, terms of service link `https://your-domain/terms`. Authorized
  domains: `your-domain`. Click **Save**.
- **Audience**: User type **External** (people connect their own Google accounts). Leave the
  publishing status at **Testing** for now. Under **Test users**, click **Add users** and add the
  Gmail address you'll use for the founder's test. The founder's test publishes the app once it
  passes.
- **Data Access**: click **Add or remove scopes**, filter for `gmail.readonly`, tick
  `.../auth/gmail.readonly`, click **Update**, then **Save**. Add nothing else.

Why each matters:

- **Only the scope the code asks for.** "When the scopes requested in your app code differ from the
  scopes requested in your OAuth consent screen configuration page, your users see an "unverified
  app" screen." ([unverified apps](https://support.google.com/cloud/answer/7454865)).
- **In production before anyone else connects.** While it says Testing, only the test users you list
  can grant access: "Projects configured with a publishing status of Testing are limited to up to
  100 test users listed in the OAuth consent screen." And each permission ends a week after it's
  given: "Authorizations by a test user will expire seven days from the time of consent. If your
  OAuth client requests an offline access type and receives a refresh token, that token will also
  expire." (Google's [audience](https://support.google.com/cloud/answer/15549945) and [unverified
  apps](https://support.google.com/cloud/answer/7454865) pages). Jane asks for offline access, so in
  Testing every mailbox stops being read a week after it's connected, and its page says "Google
  stopped accepting this connection" until the person connects it again. Testing is only for the
  founder's test, where it keeps everyone else out until the test passes.
- **In production, before Google has verified the app.** Google's sign-in page then warns people
  first, and the project can take "100 new users in total, after the app presents the unverified app
  screen". "The user cap applies over the entire lifetime of the project, and it cannot be reset or
  changed." ([unverified apps](https://support.google.com/cloud/answer/7454865)). Jane's page tells
  people about the warning before they connect (its last point, while `GMAIL_APP_VERIFIED` is false
  in `src/config/gmail.ts`).

### 4. The OAuth client

1. Open **Google Auth Platform → Clients → Create client** (in older consoles, **APIs & Services →
   Credentials → Create credentials → OAuth client ID**).
2. Application type: **Web application**. Name: "Jane Gmail web".
3. **Authorized JavaScript origins**: leave empty.
4. **Authorized redirect URIs**: click **Add URI** and enter the site's address followed by
   `/api/gmail/callback`, for example `https://your-domain/api/gmail/callback`. The site's address
   is `APP_URL` in Vercel, exactly as written there: https, the same spelling of the domain (with or
   without `www`), and no extra slash. If `APP_URL` is empty, Jane uses the project's production
   domain (Vercel's `VERCEL_PROJECT_PRODUCTION_URL`); setting `APP_URL` removes the guesswork. Jane
   sends exactly this address, so it must match letter for letter.
5. If the form has a box **Use this client for an AI-powered agent**, leave it unticked (Open
   questions for Google, below).
6. Click **Create**. A box shows the **Client ID** and the **Client secret**. Copy the Client ID
   into your note. The secret never goes in the note: keep the box open, and in another tab open
   the Jane project in Vercel, then **Settings → Environment Variables**, and add
   `GMAIL_CLIENT_SECRET` for **Production**, with the Client secret as its value. Then close the
   box.

### 5. The topic

1. Open **Pub/Sub → Topics → Create topic**.
2. Topic ID: `gmail-notices`. Untick **Add a default subscription** (step 7 makes the one Jane
   needs). Click **Create**.
3. On the topic's page, copy its full **Topic name**, `projects/<project-id>/topics/gmail-notices`,
   into your note.
4. Let Gmail publish to it. Back on **Pub/Sub → Topics**, tick the topic, and in the panel on the
   right (**Show info panel** if it's hidden) open **Permissions → Add principal**. New principal:
   `gmail-api-push@system.gserviceaccount.com`. Role: **Pub/Sub Publisher**. Click **Save**.

Google's Gmail guide says only "To do this, grant publish privileges to
gmail-api-push@system.gserviceaccount.com." and names no role ([Gmail push
notifications](https://developers.google.com/workspace/gmail/api/guides/push)). Pub/Sub's own page
says "The Pub/Sub Publisher (roles/pubsub.publisher) role includes this permission." ([Pub/Sub
access control](https://docs.cloud.google.com/pubsub/docs/access-control)). If the console refuses
the grant, the project sits under a company's Google organization whose policy keeps outside
accounts out: "Your organization's domain-restricted sharing configuration might prevent you from
granting publish permissions." (the Gmail guide again).

### 6. The service account that signs the notices

1. Open **IAM & Admin → Service Accounts → Create service account**.
2. Name: "jane-gmail-push". Click **Create and continue**, skip the optional steps that grant roles,
   and click **Done**.
3. Copy its email, as the list shows it, into your note.

Pub/Sub signs each notice in this account's name: "This account is used as the email claim of the
generated JSON Web Token (JWT)." ([creating a push
subscription](https://docs.cloud.google.com/pubsub/docs/create-push-subscription)). Jane takes a
notice only when that email matches `GMAIL_PUSH_SERVICE_ACCOUNT`.

### 7. The push subscription

First check that the address notices will go to answers itself, without a redirect. In a terminal,
with the site's address from step 4, this must print `404` while `GMAIL_LINK` is empty:
`curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST https://your-domain/api/gmail/webhook`

A status in the 300s followed by another address means Vercel redirects there (from `your-domain`
to `www.your-domain`, say): check that address the same way, and use the one that prints `404`
below. Pub/Sub takes only 102, 200, 201, 202 or 204 as an acknowledgment, so it takes a redirect as
a refusal, and no notice would ever reach Jane
([push](https://docs.cloud.google.com/pubsub/docs/push)).

Then open **Pub/Sub → Subscriptions → Create subscription**, fill in these, and click **Create**:

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

Why:

- **Payload unwrapping off.** "With payload unwrapping, the message data is delivered directly as
  the HTTP body." ([payload
  unwrapping](https://docs.cloud.google.com/pubsub/docs/payload-unwrapping)). Jane reads a notice
  inside Pub/Sub's usual wrapping (its `message.data`). With unwrapping on, every notice would be
  acknowledged and dropped as not understood, and mailboxes read only once a day.
- **Authentication and the audience.** The webhook takes a notice only with a token Google signed
  for this subscription: issued by Google, for the audience in `GMAIL_PUSH_AUDIENCE`, in the name of
  the service account in `GMAIL_PUSH_SERVICE_ACCOUNT` (`src/lib/gmail/webhook-verify.ts`). Left
  empty, the audience would be the endpoint anyway: "Note: if not specified, the Push endpoint URL
  will be used." ([subscriptions
  reference](https://docs.cloud.google.com/pubsub/docs/reference/rest/v1/projects.subscriptions)).
  Typing it makes plain what `GMAIL_PUSH_AUDIENCE` must be. Google's pages disagree on whether case
  matters: "The audience value is a single case-sensitive string." in the reference, "Audience. A
  single, case-insensitive string" in the [push subscription
  guide](https://docs.cloud.google.com/pubsub/docs/create-push-subscription). Jane compares it
  exactly, so copy it character for character.
- **A token can be an hour old.** "The tokens attached to requests sent to push endpoints may be up
  to an hour old." ([authenticating
  push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)). So Jane doesn't
  refuse a token for its age. A notice someone captured and sends again can at most start a read
  from Jane's own saved place.
- **Never expire.** "If expirationPolicy is not set, a default policy with ttl of 31 days will be
  used." ([subscriptions
  reference](https://docs.cloud.google.com/pubsub/docs/reference/rest/v1/projects.subscriptions)). A
  subscription with no activity for 31 days expires, and a quiet month (nobody connected yet, or
  reading paused) would end every notice until someone made it again.
- **A longer acknowledgement deadline.** It's 10 seconds unless set (10 to 600), and "For push
  delivery, this value is also used to set the request timeout for the call to the push endpoint."
  Jane answers before it reads, but may first fetch Google's keys (up to 10 seconds) in a function
  that has just woken up. A notice not answered in time is a refusal: "If you send a negative
  acknowledgment or the acknowledgment deadline expires, Pub/Sub resends the message.", and refusals
  slow the whole subscription ("This time span can range between 100 milliseconds to 60 seconds.")
  (Pub/Sub's [push](https://docs.cloud.google.com/pubsub/docs/push) and [subscription
  properties](https://docs.cloud.google.com/pubsub/docs/subscription-properties) pages). 60 seconds
  leaves room.
- **Everything else as it comes.** A notice that isn't acknowledged is tried again until it's 7 days
  old, the default retention (subscription properties, above).

## Add them to Vercel

In Vercel, open the Jane project, then **Settings → Environment Variables**. Add these for
**Production** only:

| Name | Value |
| --- | --- |
| `GMAIL_CLIENT_ID` | the Client ID (setup step 4) |
| `GMAIL_CLIENT_SECRET` | the Client secret, added already in setup step 4 |
| `GMAIL_PUBSUB_TOPIC` | the full topic name, `projects/<project-id>/topics/gmail-notices` (setup step 5) |
| `GMAIL_PUSH_AUDIENCE` | the Audience, exactly as typed (setup step 7) |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | the service account's email (setup step 6) |

Leave `GMAIL_LINK` empty: the founder's test sets it, and until then these do nothing. Leave
`ANTHROPIC_GMAIL_MODEL` empty too (the reader then uses `claude-haiku-5-5`), and never set
`GMAIL_API_URL` here: it's for tests, and production ignores it. Jane also uses what production has
already: `APP_URL` (setup step 4), `TOKEN_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY` and `CRON_SECRET`.

Variables take effect on the next deployment: the deploy loop's next one, or **Deployments → the
current production deployment → ⋯ → Redeploy**, as `docs/incident.md` does for a switch.

Never paste the client secret anywhere but Vercel's environment variables.

## The daily job

`/api/cron/gmail` runs at 11:15 UTC (`vercel.json`), whether or not the switch is on. It reads every
active mailbox that isn't waiting out a failure and is due: not read through in 20 hours, a code
left by its last read, or notices to ask for again. Oldest first, 20 seconds each, and about three
minutes in all. Mailboxes it doesn't reach wait for the next day. Off (`GMAIL_LINK` empty, or
`KILL_BANKS` on), it reads nothing: its run is recorded with no summary, and it answers
`{ "off": true }`.

- Its summary counts mailboxes `read`, `waiting` (Claude couldn't be asked), `failed`, `reconnect`
  and `deferred` (no time left). In Neon's SQL editor:
  `SELECT started_at, summary FROM cron_runs WHERE name = 'gmail' ORDER BY started_at DESC LIMIT 7;`
- With `HEALTHCHECKS_PING_KEY` set, its first run makes a Healthchecks check named `jane-gmail`.
  Healthchecks doesn't say what period it gives a check made that way (`docs/security/vendors.md`),
  so open it and set the period to 1 day, with a grace time of an hour or two.
- A day without a good run also sends the missed-job email (`src/lib/health.ts`), as for the other
  daily jobs.

## What must be true before switching on

All of these, in writing where it applies:

1. **Counsel's read** of the Gmail paragraphs of the Privacy Policy and the Terms, which show only
   while `GMAIL_LINK=1` (read them on a local run with the switch on, or in
   `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`), and of Google's rules for the data
   (Limits, below). The questions are in `docs/legal/README.md`. The Privacy Policy is the page
   Google's consent screen links to.
2. **Anthropic's terms on file**: what they say about training on what Jane sends, keeping it, and
   who there may read it. Google lets an app pass a person's data to another company only for the
   feature people see and "only with the user's consent", and never for "Transferring, selling, or
   using user data to create, train, or improve a machine learning or artificial intelligence model
   beyond that specific user's personalized model for the appropriate use case or user-facing
   feature." ([Workspace API user data
   policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)).
3. **What Claude's month does to mail.** Mail stops for everyone once the month's Claude spend
   reaches `GMAIL_MONTH_SHARE` (half) of `CHAT_MONTHLY_CAP_CENTS`, which is 800 cents unless it's
   set: $4 a month by default. From then until the month turns (UTC), every mailbox waits, and one
   already read says "Jane isn't reading new email right now. It will carry on by itself." A short
   wait loses nothing; one longer than about a week can (Turning it off, below). Check the cap
   leaves room, and watch `waiting` in the daily job's summary.
4. **Google Cloud and Vercel set up** as above, with `GMAIL_LINK` still empty.

Then the founder's test, below, passes.

## The founder's test

Nothing has ever talked to a real Gmail mailbox: every test uses the fake Google in
`src/lib/gmail/__fixtures__/fake-google.ts`. So the first real connection tests everything the fake
assumes, and some of it Google doesn't promise:

- that the metadata answer carries when an email arrived and its first line: the documented contract
  is the id, the labels and the headers
  ([messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
  [Format](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format));
- the form of Google's Authentication-Results header, which no Google page specifies ([email
  headers](https://support.google.com/mail/answer/180707));
- that Google's token address takes PKCE from a web client. Jane sends it, but Google's [web server
  guide](https://developers.google.com/identity/protocols/oauth2/web-server) doesn't mention it, and
  Google documents it only for installed apps: "Google supports the Proof Key for Code Exchange
  (PKCE) protocol to make the installed app flow more secure." ([installed
  apps](https://developers.google.com/identity/protocols/oauth2/native-app)).

Run it on the live site while the consent screen still says Testing, so only your test user can get
past Google's page. Use your own Jane account with a real bank linked, or none: an account whose
only bank is the demo bank can't connect. Use a Gmail mailbox of your own (your test user) that got
a few receipts or bills in the last 14 days.

1. **Switch on.** In Vercel set `GMAIL_LINK` to `1` for Production, and redeploy. Everyone signed in
   now sees mailboxes in Settings, but nobody else can get past Google's page, so do the rest
   straight away.
2. **The page.** Open **Settings**: under **Banks and files** there's **Gmail mailboxes**, "None",
   with a **Mailboxes** link (or go to `/settings/mailboxes`). The page should say "You're signed in
   to Jane as" and your email, then **Before you connect** with nine points, the last "Google hasn't
   checked Jane yet, so its page shows a warning first. That's expected during the beta.", then "By
   connecting, you agree to Jane reading this mailbox as described above." and **Agree and connect a
   Gmail mailbox**. "Connecting isn't set up yet." means `GMAIL_CLIENT_ID` or `GMAIL_CLIENT_SECRET`
   is missing.
3. **Google's pages.** Click it. Pick the mailbox, go on past Google's warning that it hasn't
   verified the app (it may be under **Advanced**), and read what Google asks to let Jane do. Write
   down its exact words. Jane's second point promises Google will ask to let Jane "view your email
   messages and settings": if Google's words differ, change that point in
   `src/config/gmail-disclosure.ts`, with a new `GMAIL_DISCLOSURE_VERSION`, before anyone else
   connects. Then allow it.
4. **Back on Jane**, the page should say "Connected." at the top, and under the mailbox "Reading
   your newest emails from the last 14 days. This takes a minute or two. Come back to this page to
   see what Jane read."
   - "That mailbox wasn't connected": when Google's side failed, Vercel's logs have `Gmail sign-in
     didn't finish` with a code. `client` is Google turning Jane's client away: check
     `GMAIL_CLIENT_SECRET`. `grant` is Google refusing the code as used already, too old, or not
     matching the sign-in it came from. Google not taking PKCE from a web client (above) may show as
     `grant`, or as `token_http_` and a status. `no_refresh` is Google sending no refresh token.
     `http_` and a status, or `signed_out`, is Gmail refusing Jane's first call: check the Gmail API
     is on (setup step 2). Anything else (`timeout`, `unreachable` and the like) is Google not
     answering as expected: try again. With no such line, the code is in the audit log. In Neon's
     SQL editor, on the production branch:
     `SELECT created_at, metadata->>'code' FROM audit_log WHERE event = 'gmail_connect_failed' ORDER BY created_at DESC LIMIT 5;`
     There, `state` is a sign-in this browser didn't start, or one that took more than 10 minutes on
     Google's page; `denied` is Cancel on Google's page; `no_code` is Google coming back with no
     code; `refused` is an account that can't connect one (a sample account); and `save` is the
     database not saving the mailbox (the logs then have `Gmail mailbox wasn't saved`).
   - "Google didn't give Jane permission to read that mailbox": Google's answer didn't grant
     `gmail.readonly`. Check the scope (setup step 3).
   - If Google's own page shows an error before you come back, compare the redirect URI with
     `APP_URL` letter for letter first: it's the setting most easily mistyped.
5. **A few minutes later**, reload. The mailbox should say "Reading new email as it arrives. Last
   checked" and a time, and **Money emails Jane read** should list emails from the last 14 days.
   - "Reading new email once a day": Google refused Jane's request for notices. The logs have
     `Gmail notices not renewed` with a code, and `/admin/health` counts it under "Gmail reads
     failed". Check `GMAIL_PUBSUB_TOPIC`, that the topic is in this project, and the Publisher grant
     (setup step 5).
   - "Jane hasn't been able to read this mailbox yet": the first read failed, and the logs have
     `Gmail read failed` with a code; or, with no such line, Claude can't be asked (no
     `ANTHROPIC_API_KEY`, `KILL_CLAUDE` on, or the month's half used). Claude not being available
     shows this line at once, straight after connecting. A first read that failed shows "Reading
     your newest emails" until 10 minutes after connecting, and this line only after that.
   - Once a mailbox has been read, "Jane isn't reading new email right now" means Claude can't be
     asked, and "The last read didn't work" means the logs have `Gmail read failed` with a code.
6. **The counts.** In Vercel's logs, find the line `Gmail read` for this first read. It holds counts
   only: `kept`, `none`, and `skipped` by reason.
   - Many `no_date`: Gmail's metadata answer has no `internalDate`, so nothing will ever be listed.
     Stop here (as the end of this test says) and fix `src/lib/gmail/message.ts` first.
   - Almost everything `unverified`: Google's header doesn't read the way `src/lib/gmail/message.ts`
     expects. Open one such receipt in Gmail with **⋮ → Show original**, and compare its
     `Authentication-Results: mx.google.com; ...` header with what `dmarcPass` reads.
   - `label`, `personal`, `security` and `no_money`: the screen doing its job.
7. **What's listed.** Compare each listed email with the email itself: the domain, the kind, the
   amount and the day. Expect a few misses, since the check is rough. Expect nothing from a personal
   address, no sign-in codes and no promotions. Then check that the screen sees an email's first
   line: find a receipt or bill outside Promotions, Social and Forums whose subject has no amount
   and none of the money words (`MONEY_SIGNS` in `src/lib/gmail/screen.ts`), but whose first line,
   as Gmail's inbox shows it after the subject, has the amount. It should be listed. If such emails
   are never listed while others are, Gmail's metadata answer has no first line, so the screen reads
   the subject alone and counts them as `no_money`: stop here, as for `no_date`, and fix that first.
8. **A new receipt within a minute.** Buy something small from a company that emails receipts, or
   wait for a real bill. Within a minute of it reaching the inbox, reload: it's listed. If it only
   shows the next day, notices aren't reaching Jane:
   - `/admin/health` counting "Gmail notices refused (not signed by Google for us)": the
     subscription's authentication is off, or its audience or service account doesn't match
     `GMAIL_PUSH_AUDIENCE` or `GMAIL_PUSH_SERVICE_ACCOUNT` exactly.
   - The log line `Gmail notice not understood`: payload unwrapping is on (setup step 7).
   - Neither: no notice reaches Jane. Open the subscription (**Pub/Sub → Subscriptions →** the
     subscription): its topic must be the one from setup step 5, and its endpoint the address
     checked in setup step 7.
9. **A forged header isn't trusted.** Send your mailbox an email carrying a header in Google's name
   that the sender wrote: a money subject such as "Your receipt: $12.34", from a company's address,
   with the added header
   `Authentication-Results: mx.google.com; dmarc=pass header.from=<the sending domain>`. Resend,
   which Jane sends with, takes added headers in its API's `headers` field (`src/lib/email.ts` uses
   it), and so do most mail tools. Bcc the same email to a mailbox outside Google (iCloud, Outlook
   or the like). If Gmail files it under Promotions, it's skipped for that and proves nothing: send
   it again. Then open the email in Gmail with **⋮ → Show original**:
   - Your header is still there: the email must not be listed (Jane sees two headers in Google's
     name and trusts neither), and the next `Gmail read` line counts it as `unverified`. If it's
     listed, stop and switch off.
   - Your header is gone: look at all the headers of the other mailbox's copy. If your header is
     there, Gmail removes such copies, which Google's pages don't say either way ([email
     headers](https://support.google.com/mail/answer/180707)). Note it in this guide. The email is
     then judged by Google's real header alone, and listed only if it really passed. If your header
     is gone from that copy too, the sending tool dropped it and the test proves nothing: send it
     another way.
10. **Nothing kept that shouldn't be.** Search Vercel's logs for your mailbox's address and for a
    word from one listed email's subject that isn't the sender's name or a kind (receipt, bill,
    renewal, price, refund), such as a product's name: neither should be there. Search the database
    for that word: nothing should have it. The sender's domain and the kind are kept on purpose.
11. **Publish.** **Google Auth Platform → Audience → Publish app**, and confirm. It should now say
    **In production**. If Google offers to start verifying the app, that can wait (Limits).
12. **Disconnect.** On the mailbox, open **Disconnect** and click **Yes, disconnect**. The page
    should say "Disconnected. Jane deleted what it read from that mailbox, and Google ended Jane's
    permission." Your Google Account's list of apps with access should then stop listing Jane,
    perhaps not at once: "Following a successful revocation response, it might take some time before
    the revocation has full effect." ([revoking a
    token](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)).
13. **Connect again.** Google's pages are now the ones everyone will see: check the warning and the
    permission's words once more. This permission doesn't end after a week, as the one given in
    Testing would have.
14. **An hour later**, once a new email has arrived, "Last checked" has moved on: renewing the
    access token works.
15. **The next day**, the daily job has run (its summary, above) and Healthchecks has `jane-gmail`:
    set its period.
16. **A week later**, the mailbox still says "Reading new email as it arrives": Jane renewed its
    request for notices, as Google requires: "You must call the watch method at least once every 7
    days or you'll stop receiving updates for the user." ([Gmail push
    notifications](https://developers.google.com/workspace/gmail/api/guides/push)).

If a step before 11 fails, disconnect your mailbox, then empty `GMAIL_LINK` and redeploy. The
subscription can stay for the next try. While the consent screen said Testing, nobody else could
have connected.

## Turning it off

**To pause, set `KILL_BANKS`** (`docs/incident.md`). It pauses the banks too: there's no switch for
mail alone. While it's on:

- Nothing is read and nothing new connects. The page says "Reading is paused for now. Jane isn't
  reading any mailbox. You can still disconnect.", and a sign-in already on Google's page comes back
  to "Connecting is paused for now. Please try again later."
- Google's notices are still checked and answered, and start no read. The daily job reads nothing
  and answers `{ "off": true }`.
- Disconnecting and deleting an account work as always.

A pause longer than about a week costs mail. Nothing renews the request for notices, which Google
needs at least every 7 days (above), and Google keeps a mailbox's history for a limited time: "A
historyId is typically valid for at least a week, but in some rare circumstances may be valid for
only a few hours."
([history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)).
When reading comes back, a mailbox that lost its place skips ahead, reads its newest 30 emails of
the last 14 days, and its page says "Jane couldn't read this mailbox for a while, so some emails
before" that day "weren't read."

**To switch off for good**, in this order:

1. **Remove every mailbox.** Ask people to disconnect, or remove each person's with
   `removeAllMailboxes` (`src/lib/gmail/mailbox.ts`): it deletes what was read and ends each
   permission at Google. The Privacy Policy and the Terms stop mentioning mailboxes the moment the
   switch is off, so a mailbox left connected would be data they no longer describe, with Jane's
   permission still standing at Google.
2. **Delete the push subscription**: **Pub/Sub → Subscriptions**, tick it, **Delete**. Google may
   keep sending notices for up to 7 days after a mailbox's last renewal, and its pages don't say
   whether ending a permission stops them sooner ([Gmail push
   notifications](https://developers.google.com/workspace/gmail/api/guides/push)). Once the switch
   is off the webhook answers 404, and Pub/Sub takes only 102, 200, 201, 202 or 204 as an
   acknowledgment: for anything else "Pub/Sub resends the message", for 7 days by default, slowing
   the whole subscription ([push](https://docs.cloud.google.com/pubsub/docs/push)). With no
   subscription, nothing is sent.
3. **Empty `GMAIL_LINK`** and redeploy. There's then no Connect link, the connect, callback and
   webhook routes answer 404, and the daily job reads nothing. A person who still has a mailbox sees
   it with "Mailboxes are switched off for now. Jane isn't reading this mailbox. Disconnect to
   delete what Jane read from it.", and can still disconnect. Account deletion and the inactivity
   clean-up still remove mailboxes.
4. **Check none is left.** Until step 3, anyone could still connect a mailbox. In Neon's SQL editor,
   on the production branch, `SELECT count(*) FROM gmail_mailboxes;` must say 0. Remove any left
   with `removeAllMailboxes`, which works with the switch off.

## The way back

Google is told `<site>/api/gmail/callback`, where `<site>` is `APP_URL`, else Vercel's production
address, else the address in `AUTH_URL` (`callbackOrigin` in `src/lib/gmail/oauth.ts`). On a laptop
with none of them set, it's the address the site is opened at; in production with none, the Connect
link answers "Connecting isn't set up yet." Keep this path (`GMAIL_CALLBACK_PATH`): it's registered
in the OAuth client. The push subscription's endpoint names the site too.

If the site's address changes, first add `<new site>/api/gmail/callback` to the client's
**Authorized redirect URIs** (setup step 4), then change `APP_URL`, then the subscription's endpoint
URL (**Pub/Sub → Subscriptions →** the subscription **→ Edit**) and the consent screen's links and
authorized domain. The audience can stay as it was typed: it's only a string Jane compares, as long
as `GMAIL_PUSH_AUDIENCE` still matches it.

## Tests and local runs

- Every test uses the fake Google in `src/lib/gmail/__fixtures__/fake-google.ts`, on a port on the
  test machine. `GMAIL_API_URL` points Jane at it. It counts only for `localhost`, `127.0.0.1` or
  `[::1]`, and never when `VERCEL_ENV` is `production`; any other address is ignored, so a setting
  can't send a person's tokens or mail to another company.
- `npx vitest run src/lib/gmail` runs the unit tests. With `TEST_DATABASE_URL` set it also runs the
  integration tests: reading, saving and removing, the routes, the daily job, account deletion and
  the inactivity clean-up. The page, the Disconnect action, the job's route and the legal words have
  tests beside them (`src/app/settings/mailboxes/`, `src/app/api/cron/gmail/route.test.ts`,
  `src/app/legal-pages-gmail.test.tsx`).
- There's no end-to-end browser spec, on purpose: the switch is off by default and Google's pages
  can't be driven. `src/lib/gmail/routes.integration.test.ts` drives the connect, callback and
  webhook routes instead.
- To run it on a laptop against the real Google, use a Google Cloud project of its own for
  development, set up as above but with your local address followed by `/api/gmail/callback` as the
  redirect URI, and leave `GMAIL_PUBSUB_TOPIC` empty: Google can't send notices to a laptop. A
  mailbox is then read when you connect it (connect it again to read what came since), and by the
  daily job, which you call yourself:
  `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/gmail`. It reads only
  mailboxes due a read: not read in 20 hours, or whose last read failed. Leaving the topic empty is
  for this only: in production the daily job would then be the only reader, with 20 seconds and 60
  emails a mailbox a day, which a busy mailbox outgrows.

## Limits

- **100 people in all, for the project's whole life, while Google hasn't verified the app** (setup
  step 3). Development and staging get projects of their own so they never use any of them.
- **Before a public launch**, Google's verification of the app. For a restricted scope it includes a
  security assessment, "If you store restricted scope data on servers (or transmit), then you must
  go through a security assessment.", and then again: "apps must be reverified for compliance and
  complete a security assessment at least every 12 months after your assessor's Letter of Assessment
  (LOA) approval date" ([restricted scope
  verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
  Once Google has verified it, set `GMAIL_APP_VERIFIED` to `true` in `src/config/gmail.ts`: the
  page's warning point goes, and since the words change, `GMAIL_DISCLOSURE_VERSION` must change too
  (its test fails until it does).
- **Google's rules for the data, "Limited Use"** ([Workspace API user data
  policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), updated
  2026-09-03; Google's general [API Services User Data
  Policy](https://developers.google.com/terms/api-services-user-data-policy), last updated February
  15, 2024, has the same four rules, without the line on AI models and with slightly different
  exceptions for people reading data). Use is limited to "providing or improving your appropriate
  use case or features that are visible and prominent in the requesting application's user
  interface". Data may go to another company to provide that, "and only with the user's consent" (or
  for security, the law, or a merger). "Do not allow humans to read user data, unless" the person
  consents for specific messages, it's for security or the law, or it's aggregated and anonymized.
  And never for ads, never "to determine credit-worthiness or for lending purposes", and never to
  train an AI model beyond the person's own. The policy also asks for tokens "encrypted at rest",
  "Protecting against prompt injection techniques by either using Google Cloud Platform's Model
  Armor or other prompt injection protection.", and a disclosure inside the app that "Cannot be
  placed only in a privacy policy or terms of service" (Jane's is the points above the Connect
  link). Jane keeps to it today by using what it reads only for the list on the mailboxes page.
  Before a chat, a card, a deadline, a team page, a partner or a lending feature may read the mail
  tables, someone has to decide how advice mode and these rules apply. Lending matters most: Jane
  has loan features and a lender partner.
- **The disclosure sentence.** Google gives three wordings. The policy's: "The use of information
  received from Google Workspace scopes will adhere to the Google User Data Policy, including the
  Limited Use requirements." The verification help's: "{App's} use of information received from
  Google APIs will adhere to Google API Services User Data Policy, including the Limited Use
  requirements." The use-case page's: "The use of raw or derived user data received from Workspace
  APIs will adhere to the Google User Data Policy, including the Limited Use requirements."
  (Google's help pages [13463817](https://support.google.com/cloud/answer/13463817),
  [13805798](https://support.google.com/cloud/answer/13805798) and
  [13806988](https://support.google.com/cloud/answer/13806988), and the policy above). `/privacy`
  uses the second, in Jane's words, with the rules above in plain words after it.
- **Quota.** For projects made from 2026-05-01: `messages.get` costs "20 (60 when format is full,
  raw, or html)" units, and one Google account may use 6,000 units a minute in one project ([Gmail
  API quota](https://developers.google.com/workspace/gmail/api/reference/quota)). A read asks Gmail
  about 60 emails at most (`runMessages`), a metadata look each and a full fetch for those that
  pass: 4,800 units for the emails and a few more for the listing, under that limit even if it all
  fell in one minute. Check the project's real numbers on the Gmail API's quotas page in the console
  before a launch.
- **A password change at Google** ends the connection (above), and the person connects again.
- **Inactivity.** The clean-up runs inside the banks' daily job (`/api/cron/plaid-sync`), and only
  while Plaid is set up and `KILL_BANKS` is off (`plaidEnabled()`): in production, every day unless
  `KILL_BANKS` is on. After 60 days unused, with an email 7 days before, it removes the person's
  mailboxes as Disconnect does.
- **Claude**: 60 emails a day and 600 in 30 days a person, 15 a day from one sender, and mail stops
  for the month at half the cap (before switching on, item 3).
- **Five mailboxes a person** (`mailboxesMost`), and the first read takes the newest 30 emails of
  the last 14 days.
- **Notices aren't certain**: "in rare situations, notifications might be delayed or dropped"
  ([Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)). The
  daily job reads what they missed.

## Known limits

The sender check (`verifiedSender` in `src/lib/gmail/message.ts`):

- **A pass names a domain, not an honest company.** A scammer's own domain passes for itself. The
  page says so above the list: "It can't tell whether the email is honest, so if you don't recognize
  one, don't pay or call from it."
- **The mailbox's owner can make any sender look checked.** Mail put in through Gmail's API goes in
  "similar to IMAP APPEND, bypassing most scanning and classification"
  ([messages.insert](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/insert)),
  so it may carry a header its writer made up and none from Google's servers. Only that person's own
  page is affected.
- **Google documents neither the header's form nor that it removes a copy the sender wrote** ([email
  headers](https://support.google.com/mail/answer/180707)). So Jane trusts an email only when
  exactly one header is in Google's name, whatever order the headers come in, and the founder's test
  checks a real mailbox.
- **Forwarded mail.** Mail forwarded from another Gmail mailbox, or through Google Groups, is
  expected to carry two headers in Google's name, one from each pass through Google's servers
  (Google doesn't document it), and is skipped. Mail forwarded from iCloud, Outlook and the like
  often fails Google's check: "forwarded messages often fail SPF authentication", and "Gmail does
  its own authentication check on forwarded messages." (Google's
  [forwarding](https://support.google.com/mail/answer/175365) and
  [ARC](https://knowledge.workspace.google.com/admin/security/arc-email-authentication) pages). The
  page tells people some forwarded emails will be missed.
- **Mail Gmail fetched from another mailbox** (it carries `X-Gmail-Fetch-Info`) is skipped: Jane
  takes it that Google's servers never checked who sent it.
- **DMARC only.** A company whose mail doesn't pass DMARC for its own From domain is never read,
  even with a good DKIM signature.

And one about connecting: **a sign-in link someone else sent** can still land a person on the
mailboxes page of the sender's Jane account, one tap from Google. The Connect link works only with a
ticket made for that browser's own session (`src/lib/gmail/connect-ticket.ts`), so such a link can't
lead straight to Google's page, and the page names the account above the link ("You're signed in to
Jane as"). Tell people to check that name before they connect.

## Open questions for Google

- **Is Jane's reader an "AI-powered agent"?** Google's console can mark a client "Use this client
  for an AI-powered agent", and an app with both interactive and agent workflows "must create and
  maintain separate OAuth 2.0 client IDs for each workflow" ([AI agent
  clients](https://support.google.com/cloud/answer/15549257)). Jane has one client: a person
  connects, and Jane then reads on its own with nobody there. Which of the two Google counts that as
  isn't settled. Ask during verification; until then the box stays unticked.
- **Is Jane's protection against prompt injection enough?** Google's policy asks for Model Armor "or
  other prompt injection protection" (Limits). Jane's is its own: every request to Claude carries
  `UNTRUSTED_TEXT_RULE` (`src/lib/untrusted-text.ts`), and code checks Claude's three answers, so
  nothing depends on Claude having listened (`src/lib/gmail/read-mail.ts`). Whether that's enough is
  for Google's review.
- **Email text going to Anthropic.** Google's pages don't address an outside AI provider in those
  words. By their text it's passing data to another company: allowed for the feature people see,
  "only with the user's consent", and the provider must not train on it. Jane names Anthropic, and
  what it's sent, above the Connect link (`src/config/gmail-disclosure.ts`).

## When someone asks what Jane reads

Something like this, in your own words:

> Jane looks at who sent each new email, its subject and its first line or two. It skips spam, the
> trash, what you sent, and the Promotions, Social and Forums tabs. When you first connect, it
> starts with your newest 30 emails from the last 14 days. It reads a whole email only when Google's
> own check shows it came from a company's domain, not a personal address like gmail.com, and it
> looks like it's about money. It skips anything that looks like a sign-in code or a password reset.
> Before Claude, the AI from Anthropic, sees an email, Jane takes out links, email addresses and
> long numbers. Claude picks out what kind of email it is, the amount and the date, and Jane saves
> those with the sender's domain, when the email arrived and Gmail's id for it. It saves no text
> from the email, and nothing about the emails it skipped. It can't send, delete or change anything
> in your mailbox. In Jane, only you see what it found, in Settings under Mailboxes and in Download
> my data, and nothing else in Jane uses it. Disconnecting there deletes it all and asks Google to
> end Jane's permission. You can also remove Jane in your Google Account.
