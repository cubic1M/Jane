import { LegalPage } from "@/components/legal-page";
import { COMPANY_NAME, contactEmail } from "@/config/legal";

export const metadata = { title: `Security | ${COMPANY_NAME}` };

export default function SecurityPage() {
  return (
    <LegalPage title="How we keep your data safe">
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
          factor, and every view of your data is written to an audit log.
        </li>
        <li>
          <strong>Abuse protection.</strong> Sign-in, bank linking and other actions are rate
          limited, and the beta is invite-only.
        </li>
        <li>
          <strong>Your control.</strong> Disconnect a bank or delete everything in Settings at any
          time. Inactive bank connections are removed after 60 days.
        </li>
        <li>
          <strong>Checks on every change.</strong> Automated tests, dependency vulnerability
          scanning and secret scanning run on every code change.
        </li>
      </ul>
      <p>Found a security problem? Please tell us at {contactEmail()}.</p>
    </LegalPage>
  );
}
