import { LegalPage } from "@/components/legal-page";
import { COMPANY_NAME, contactEmail } from "@/config/legal";
import { retentionPolicy } from "@/lib/retention";

export const metadata = { title: `Privacy Policy | ${COMPANY_NAME}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {COMPANY_NAME} helps you find money you&apos;re losing and fix it with your approval. This
        page explains what we read, what we keep, who we share it with, and how to delete it.
      </p>

      <h2>What we read</h2>
      <ul>
        <li>Your email address and, if you use Google sign-in, your name.</li>
        <li>
          Transactions, account names, account types and balances from the banks you link, read-only
          through Plaid. We can never move your money.
        </li>
        <li>CSV statements you upload. Files are read once and never stored.</li>
        <li>
          What you do in the app: which findings you open, your yes or no answers, and settings.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To find subscriptions, fees, idle cash, insurance and interest costing you money.</li>
        <li>So our team can carry out the changes you approve, and nothing you haven&apos;t.</li>
        <li>To send the emails you ask for: sign-in links, status updates and a weekly summary.</li>
        <li>To improve the product, using counts and trends rather than individual records.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>Plaid</strong> connects your bank. Plaid&apos;s own privacy policy covers what
          Plaid does with your data.
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> writes plain-language explanations. It receives only
          the type of finding, merchant names, amounts, dates and our savings estimate, never your
          name, email, account names or numbers.
        </li>
        <li>
          <strong>Service providers</strong> that run the app for us: hosting (Vercel), database,
          email delivery (Resend), analytics, and payments (Stripe) if you choose to pay.
        </li>
        <li>
          <strong>Merchants and partners</strong>, only the details needed to complete an action you
          approved, such as asking a company to cancel a subscription.
        </li>
      </ul>
      <p>We don&apos;t sell your data.</p>

      <h2>How we protect it</h2>
      <ul>
        <li>Bank connection tokens are encrypted (AES-256-GCM) and never shown or logged.</li>
        <li>Each person&apos;s data is only ever read for that person.</li>
        <li>
          Team access needs a second sign-in factor, and every team view of your data is logged.
        </li>
        <li>Error logs have email addresses, card and account numbers, and tokens removed.</li>
      </ul>

      <h2>How long we keep it, and deleting it</h2>
      <ul>
        {retentionPolicy().map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          You can disconnect a bank or delete all your data at any time in Settings. Deleting
          disconnects every bank at Plaid and removes everything we hold about you. A record that a
          deletion happened, without personal details, stays in our security log.
        </li>
      </ul>

      <p>You can download a copy of your data in Settings.</p>

      <h2>Email and tracking</h2>
      <p>
        Weekly emails can be turned off in Settings or with one click from the email. We note when
        you click a link in our emails; we don&apos;t use tracking pixels or advertising cookies.
      </p>

      <h2>Contact</h2>
      <p>Questions or requests: {contactEmail()}.</p>
    </LegalPage>
  );
}
