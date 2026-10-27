import { Suspense } from "react";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_NAME, contactEmail } from "@/config/legal";
import { YourActivity } from "./your-activity";

export const metadata = { title: `Security | ${COMPANY_NAME}` };

export default function SecurityPage() {
  return (
    <LegalPage title="How we keep your data safe">
      <Suspense>
        <YourActivity />
      </Suspense>
      <ul>
        <li>
          <strong>Read-only bank access.</strong> We connect through Plaid with the Transactions
          product only. We can see transactions and balances; we can&apos;t move money.
        </li>
        <li>
          <strong>Encryption.</strong> Bank connection tokens are encrypted with AES-256-GCM, the
          key is kept outside our code, and connections use HTTPS with HSTS.
        </li>
        <li>
          <strong>Separation.</strong> Every query for your data is limited to your account by a
          single, tested helper.
        </li>
        <li>
          <strong>Team access.</strong> Our team pages require an admin role and a second sign-in
          factor, and every team page view and action is written to an audit log.
        </li>
        <li>
          <strong>Abuse protection.</strong> Every sign-in, bank link, chat message and other action
          is rate limited, and the beta is invite-only.
        </li>
        <li>
          <strong>Your control.</strong> Disconnect a bank or delete everything in Settings at any
          time. Inactive bank connections are removed after 60 days.
        </li>
        <li>
          <strong>Checks on every change.</strong> Automated tests, dependency vulnerability
          scanning and secret scanning run on every code change.
        </li>
        <li>
          <strong>Sign-in records.</strong> Every sign-in, sign-out and failed attempt, two-factor
          change, bank link, data download and account deletion is recorded with its time, IP
          address and browser. Signed in, you see your own at the top of this page.
        </li>
        <li>
          <strong>Browser protections.</strong> Pages only run Jane&apos;s own code, can&apos;t be
          shown inside other sites, and use HTTPS only.
        </li>
      </ul>
      <p>Found a security problem? Please tell us at {contactEmail()}.</p>
    </LegalPage>
  );
}
