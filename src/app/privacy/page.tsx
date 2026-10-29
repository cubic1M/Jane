import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { ACTIVITY_DISCLOSURE } from "@/config/activity";
import { COMPANY_NAME, contactEmail } from "@/config/legal";
import { TRIAL_HOURS } from "@/config/trial";
import { retentionPolicy } from "@/lib/retention";

export const metadata = { title: `Privacy Policy | ${COMPANY_NAME}` };

// The closed beta's privacy policy (a draft for counsel; the claims to check are in
// docs/legal/README.md). Written from what the code does today, not from the spec: keep it in
// step with src/app/terms/page.tsx. The retention list comes from src/config/retention.ts, so
// the two can't disagree.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Jane, run by {COMPANY_NAME} (&quot;we&quot;), reads your bank accounts to find money
        you&apos;re losing and to answer your questions about your own money. This page says what we
        collect, who else sees it, how long we keep it, and how to delete it.
      </p>

      <h2>In short</h2>
      <ul>
        <li>Jane reads your banks, read-only. It can never move money.</li>
        <li>We don&apos;t sell your data, and we don&apos;t use it for advertising.</li>
        <li>For your real accounts, Jane doesn&apos;t give financial advice.</li>
        <li>You can delete everything, in one step, at any time.</li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>Your email address and, if you sign in with Google, your name.</li>
        <li>
          From the banks you link, through Plaid and read-only: account names and types, the last
          four digits of account numbers, balances and transactions. If your bank shares them, also
          loan and card details (such as rates and payments) and, once Jane turns investment
          accounts on, investment holdings and their trades.
        </li>
        <li>
          CSV statements you upload. Each file is read once, in memory, and never stored as a file;
          we keep only the transactions read from it.
        </li>
        <li>
          What you tell Jane: your chat messages, your answers to its questions (like your tax
          filing status or your goals), and documents you choose to keep with Jane, such as an
          insurance policy or a receipt.
        </li>
        <li>
          How you use Jane: which pages and suggestions you open, your yes or no answers, and your
          settings. {ACTIVITY_DISCLOSURE} That means the pages you open, the buttons you press,
          which form fields you fill in and how long you stay, kept in our own database. For what
          you type we keep only that you typed and how many characters, never the words or numbers
          themselves (your chat messages and card answers are kept as above). Admins, sample-data
          trials and the demo bank are never recorded.
        </li>
        <li>
          During the closed beta: the invite code you signed up with. If you join the waitlist, your
          email address; we send it nothing until a founder invites you.
        </li>
        <li>If you turn on notifications: the address your browser gives us to send them to.</li>
        <li>
          If you report a problem: what you write and the page you were on, nothing else. The
          founders read it, and it&apos;s deleted with your account.
        </li>
        <li>
          For security: when you sign in or out, change two-factor, link or disconnect a bank,
          download your data or delete your account, we record the time, your IP address, your
          browser and roughly where it is (city and country). You can see your own on the Security
          page.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>
          To find subscriptions, fees, idle cash, insurance costs and interest, and to explain them.
        </li>
        <li>To answer what you ask Jane in the chat.</li>
        <li>
          To show you the steps and draft messages for a change you decide to make. For your real
          accounts you make the change yourself: Jane doesn&apos;t contact companies for you.
        </li>
        <li>
          To send the emails you ask for: sign-in links, and summaries, reminders and alerts you can
          turn off.
        </li>
        <li>
          To run the beta and improve Jane: the founders look at counts and trends, and during the
          beta at how each person moves through the app, to find what&apos;s confusing.
        </li>
      </ul>

      <h2>What Jane remembers about you</h2>
      <ul>
        <li>
          Jane builds a picture of you so its answers fit: things like whether you rent, when
          you&apos;re paid, your main bank, your goals and how you like to do things. It learns
          these from your statements, your answers, what you say in the chat and what you do with
          its suggestions, and keeps each one with where it came from and how sure it is.
        </li>
        <li>
          Every chat message and answer is kept with your account. Each time you sign in the chat
          starts empty: older conversations aren&apos;t shown, but what Jane learned from them is
          still used.
        </li>
        <li>
          Jane never keeps anything about your health, religion, politics, sexual orientation,
          ethnicity or immigration status, even when your transactions or your words hint at it.
        </li>
        <li>
          Signed in, Settings has{" "}
          <Link href="/settings/memory" className="underline">
            What Jane knows about you
          </Link>
          : every fact, where it came from and how sure Jane is. You can correct or forget any of
          them, or delete all of Jane&apos;s memory and your stored chat at once. All of it is in
          Download my data, and goes when you delete your account or a trial ends.
        </li>
      </ul>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>Plaid</strong> connects your bank, read-only. Jane asks Plaid only for
          transactions, and for loan and card details where your bank shares them (investment
          details too, once Jane turns investment accounts on); never for anything that moves money.
          Plaid&apos;s own privacy policy covers what Plaid does with your data.
        </li>
        <li>
          <strong>Anthropic</strong> makes Claude, the AI model that writes Jane&apos;s answers and
          explanations. What it receives:
          <ul>
            <li>
              In the chat: your message, your recent messages and Jane&apos;s answers, what Jane
              remembers about you (above), and the parts of your data the answer needs, such as
              balances, amounts, dates, categories and cleaned-up merchant names.
            </li>
            <li>
              For the text on Jane&apos;s cards, the monthly check-in and the weekly review: the
              figures and facts behind each one.
            </li>
            <li>
              When you upload a document for Jane to read (a policy, a tax notice, a tax return):
              that file, to pull out its key facts.
            </li>
            <li>
              To tell whether a charge is a subscription: the merchant&apos;s cleaned-up name only.
            </li>
          </ul>
          It never receives your password, your bank sign-in, your Plaid connection, your account
          numbers or your raw bank descriptions.
        </li>
        <li>
          <strong>Resend</strong> delivers our emails, so it receives your email address and each
          email&apos;s contents.
        </li>
        <li>
          <strong>PostHog</strong>, when we have it switched on, receives product analytics from our
          servers: the names of actions taken in Jane (like &quot;opened a suggestion&quot;),
          sometimes with a figure such as an amount saved, keyed by a random account id. Never your
          email, your account details or your transactions.
        </li>
        <li>
          <strong>Your browser&apos;s push service</strong> (from Google, Apple or Mozilla, say)
          carries notifications if you turn them on.
        </li>
        <li>
          <strong>Service providers</strong> that run Jane for us: hosting (Vercel), our database,
          and payments (Stripe) if you choose to pay.
        </li>
        <li>
          <strong>Market prices</strong> for the practice and paper accounts come from Alpaca or
          Yahoo Finance. We ask them for prices of funds by ticker only, never anything about you.
        </li>
      </ul>

      <h2>Practice and paper accounts</h2>
      <p>
        Jane&apos;s practice portfolio and paper account use simulated money only: no real orders,
        no broker and no real account. For now they&apos;re offered only with sample data (the demo
        bank or Try Jane). What they hold, their simulated trades and their value each day are kept
        with your account and deleted with it.
      </p>

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
          Your account data (transactions, balances, chats, answers, documents, and practice and
          paper accounts) stays until you delete it, or delete your account.
        </li>
        <li>Disconnecting a bank deletes the transactions we read from it.</li>
        {retentionPolicy().map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          Trying Jane with sample data makes a made-up person, deleted after {TRIAL_HOURS} hours
          with everything done with them. Trials are never emailed and never counted in our
          analytics.
        </li>
      </ul>

      <h2>Deleting your data</h2>
      <p>
        In Settings, &quot;Delete all my data&quot; does it in one step. Jane first disconnects
        every bank at Plaid, then deletes your account and everything in it: transactions, balances,
        chats, answers, documents, notifications, and practice and paper accounts. If Plaid
        can&apos;t be reached, nothing is deleted and you can try again. Afterwards you see a page
        confirming your data is deleted. A record that the deletion happened, with ids, the time and
        the IP address and browser it came from, stays in our security log for the period listed
        above. You can download a copy of your data in Settings first.
      </p>

      <h2>Cookies and your browser</h2>
      <ul>
        <li>A sign-in cookie keeps you signed in. Signing out ends it.</li>
        <li>
          While you sign up, two short cookies (15 minutes) remember your invite code and that you
          agreed to these terms.
        </li>
        <li>
          A random id cookie (kept for a year) lets us count visits, including before you have an
          account. It holds no personal details.
        </li>
        <li>
          During the beta, a random visit id, kept in the browser tab until you close it, groups the
          pages you open in one visit. It holds no personal details.
        </li>
        <li>
          Your browser also remembers small display choices, like whether the chat panel is open.
          These stay on your device.
        </li>
      </ul>
      <p>We don&apos;t use advertising cookies or tracking pixels.</p>

      <h2>Email</h2>
      <p>
        Summary and reminder emails can be turned off in Settings, or with one click from the email.
        We note when you click a link in our emails. Before disconnecting banks you haven&apos;t
        used for a while, we email you first.
      </p>

      <h2>Contact</h2>
      <p>Questions, or a request about your data: {contactEmail()}.</p>
    </LegalPage>
  );
}
