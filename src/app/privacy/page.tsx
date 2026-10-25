import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_NAME, contactEmail } from "@/config/legal";
import { TRIAL_HOURS } from "@/config/trial";
import { retentionPolicy } from "@/lib/retention";

export const metadata = { title: `Privacy Policy | ${COMPANY_NAME}` };

// The closed beta's privacy policy (a draft for counsel; open questions in
// docs/legal/README.md). Written from what the app does; the retention list comes from
// src/config/retention.ts, so the two can't disagree.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Jane, run by {COMPANY_NAME}, reads your accounts to find money you&apos;re losing and answer
        your questions about it. This page says what we collect, who else sees it, how long we keep
        it, and how to delete it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your email address and, if you sign in with Google, your name.</li>
        <li>
          From the banks you link, through Plaid and read-only: account names and types, the last
          four digits of account numbers, balances, transactions, loan and card details such as
          rates and payments, and investment holdings. Jane can never move your money.
        </li>
        <li>CSV statements you upload. Each file is read once in memory and never stored.</li>
        <li>
          What you tell Jane: your chat messages, answers to her questions (like your tax filing
          status or goals), and the documents you choose to keep with us, such as insurance policies
          or receipts.
        </li>
        <li>
          How you use Jane: which pages and suggestions you open, your yes or no answers, and your
          settings.
        </li>
        <li>
          During the closed beta: the invite code you signed up with, and, if you join the waitlist,
          your email address. We send nothing to a waitlist address until a founder invites you.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>
          To find subscriptions, fees, idle cash, insurance costs and interest, and to explain them.
        </li>
        <li>To answer what you ask Jane in the chat.</li>
        <li>So Jane or our team can do the changes you approve, and nothing you haven&apos;t.</li>
        <li>
          To send the emails you ask for: sign-in links, updates on things you approved, summaries
          and reminders you can turn off.
        </li>
        <li>
          To run the beta and improve Jane, using counts and trends rather than individual records.
        </li>
      </ul>
      <p>We don&apos;t sell your data, and we don&apos;t use it for advertising.</p>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>Plaid</strong> connects your bank, read-only. Plaid&apos;s own privacy policy
          covers what Plaid does with your data.
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> writes Jane&apos;s answers and explanations. To answer
          you, it receives your message, the recent chat, and the parts of your financial data the
          answer needs, such as balances, transactions, merchant names and amounts. It can include
          your name when Jane drafts a letter for you to send. It never receives your password, your
          bank sign-in or your Plaid connection. When you upload a document for Jane to read, Claude
          receives that file to pull out its key facts.
        </li>
        <li>
          <strong>Resend</strong> delivers our emails, so it receives your email address and the
          email&apos;s contents.
        </li>
        <li>
          <strong>PostHog</strong> receives product analytics: the names of actions taken in Jane
          (like &quot;opened a suggestion&quot;), sometimes with a figure such as the amount a
          change saved, keyed by a random account id. Never your email, your account details or your
          transactions. We send these from our servers, so there are no analytics cookies in your
          browser.
        </li>
        <li>
          <strong>Service providers</strong> that run Jane for us: hosting (Vercel), our database,
          and payments (Stripe) if you choose to pay.
        </li>
        <li>
          <strong>Companies and partners</strong>: only the details needed to complete something you
          approved, such as asking a company to cancel a subscription.
        </li>
      </ul>

      <h2>How we protect it</h2>
      <ul>
        <li>Plaid connection tokens are encrypted (AES-256-GCM) and never shown or logged.</li>
        <li>Documents you upload are encrypted (AES-256-GCM), and only you can open them.</li>
        <li>Each person&apos;s data is only ever read for that person.</li>
        <li>
          Team access needs a second sign-in factor, and every team view of your data is logged.
          Signed in, you can see each one under{" "}
          <Link href="/settings/team-access" className="underline">
            Who saw my data
          </Link>
          .
        </li>
        <li>Error logs have email addresses, card and account numbers, and tokens removed.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Your account data (transactions, balances, chats, answers and documents) stays until you
          delete it, or delete your account.
        </li>
        <li>Disconnecting a bank deletes the transactions we read from it.</li>
        {retentionPolicy().map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          Trying Jane with sample data makes a made-up person, deleted after {TRIAL_HOURS} hours
          with everything done with them. It&apos;s never counted in our analytics.
        </li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        In Settings, &quot;Delete all my data&quot; does it in one step. It disconnects every bank
        at Plaid, then removes everything we hold about you. A record that a deletion happened, with
        ids but no personal details, stays in our security log. You can also download a copy of your
        data in Settings first.
      </p>

      <h2>Email and tracking</h2>
      <p>
        Summary and reminder emails can be turned off in Settings or with one click from the email.
        We note when you click a link in our emails. We don&apos;t use tracking pixels or
        advertising cookies; our cookies only keep you signed in and remember a sign-up in progress.
      </p>

      <h2>Contact</h2>
      <p>Questions, or a request about your data: {contactEmail()}.</p>
    </LegalPage>
  );
}
