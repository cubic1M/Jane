import { LegalPage } from "@/components/legal-page";
import { COMPANY_NAME, contactEmail } from "@/config/legal";
import { TRIAL_HOURS } from "@/config/trial";

export const metadata = { title: `Terms of Service | ${COMPANY_NAME}` };

// The closed beta's terms (a draft for counsel; the claims to check are in docs/legal/README.md).
// Written from what the code does today, not from the spec: keep them in step with
// src/app/privacy/page.tsx.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms cover Jane, run by {COMPANY_NAME} (&quot;we&quot;), during its closed beta. By
        creating an account or trying Jane, you agree to them.
      </p>

      <h2>A closed beta</h2>
      <ul>
        <li>
          Jane is in a private beta for the founders and the people they invite. Creating an account
          needs an invite code.
        </li>
        <li>
          Jane is provided &quot;as is&quot;. Features may change or stop, the service may be down,
          and Jane can make mistakes. Check anything important with your bank or the company
          involved before you rely on it.
        </li>
        <li>
          We may end the beta, or your access to it, at any time. We&apos;ll tell you first when we
          can.
        </li>
      </ul>

      <h2>What Jane does</h2>
      <ul>
        <li>
          Jane reads the bank accounts you link, read-only, through Plaid, and the statements you
          upload. It shows you where you may be losing money and answers your questions about your
          own accounts.
        </li>
        <li>
          Jane never moves money. It can&apos;t make payments, transfers or trades, and it never
          holds your funds.
        </li>
        <li>
          When you decide to make a change, such as cancelling a subscription, Jane gives you the
          steps and a draft message, and you make the change yourself. For your real accounts, Jane
          and our team don&apos;t contact companies for you.
        </li>
        <li>We never ask for or keep your passwords for your bank or any other service.</li>
      </ul>

      <h2>No financial advice for your real accounts</h2>
      <ul>
        <li>
          For your real accounts, Jane gives general information about your own money. It
          doesn&apos;t give investment, tax, legal or other professional advice, and it doesn&apos;t
          recommend specific investments, tax positions, insurance or loans.
        </li>
        <li>
          Savings figures are estimates from your past transactions, not promises. Talk to a
          licensed professional before a big financial decision.
        </li>
        <li>
          With sample data only (the demo bank or Try Jane), Jane may show example recommendations,
          labelled &quot;Demo advice: sample data, not financial advice&quot;. They&apos;re made for
          the sample person and are not advice to you.
        </li>
      </ul>

      <h2>Practice and paper accounts</h2>
      <ul>
        <li>
          Jane&apos;s practice portfolio and paper account use simulated money only. No real order
          is ever placed, there is no broker, and no real account is opened or changed.
        </li>
        <li>
          The paper account runs the strategy you pick on real market prices. Its trade alerts, and
          the strategies&apos; past results, are a replay and a simulation, not a forecast: real
          results would be different.
        </li>
        <li>For now, both are offered only with sample data (the demo bank or Try Jane).</li>
      </ul>

      <h2>Answers written by AI</h2>
      <p>
        Jane&apos;s answers and explanations are written with the help of Claude, an AI model made
        by Anthropic. They can be wrong or out of date. The figures Jane shows come from your
        accounts, but how they&apos;re explained can still miss something.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or older and only link accounts that are yours to share.</li>
        <li>Keep your email secure: sign-in links go there.</li>
        <li>Don&apos;t share your invite code unless a founder says you can.</li>
        <li>
          You can disconnect a bank, download your data, or delete everything at any time in
          Settings.
        </li>
        <li>We may suspend an account that misuses Jane or puts others at risk.</li>
      </ul>

      <h2>Trying Jane with sample data</h2>
      <p>
        When it&apos;s offered, &quot;Try Jane&quot; signs you in as a made-up sample person for{" "}
        {TRIAL_HOURS} hours, without an account. It never uses real accounts, never emails you,
        never contacts a real company (any company it writes to is simulated), and is deleted
        afterwards with everything done in it.
      </p>

      <h2>Partners and payments</h2>
      <ul>
        <li>
          Some suggestions may name a partner, such as a savings account or insurance marketplace.
          When we may earn a fee, the suggestion says so before you decide.
        </li>
        <li>
          Any membership offered during the beta is a test. We&apos;ll tell you before any recurring
          charge.
        </li>
      </ul>

      <h2>Liability</h2>
      <p>
        We work carefully, but to the extent the law allows, we aren&apos;t liable for indirect
        losses, for decisions you make using Jane, or for what banks, companies or partners do.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If these terms change in a way that matters, we&apos;ll ask you to accept the new version
        before you carry on. Questions, or to report a problem: {contactEmail()}.
      </p>
    </LegalPage>
  );
}
