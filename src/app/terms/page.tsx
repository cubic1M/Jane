import { LegalPage } from "@/components/legal-page";
import { COMPANY_NAME, contactEmail } from "@/config/legal";

export const metadata = { title: `Terms of Service | ${COMPANY_NAME}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <h2>What the service does</h2>
      <p>
        {COMPANY_NAME} reads your transactions, shows you where you may be losing money, and, only
        after you say yes to a specific card, has our team work on that change for you. We never
        move money, hold funds, or trade investments.
      </p>

      <h2>No financial, investment, tax or legal advice</h2>
      <p>
        Findings and explanations are general information about your own transactions. They
        aren&apos;t investment, tax, legal or other professional advice. Savings figures are
        estimates based on your past transactions, not promises.
      </p>

      <h2>Your approvals</h2>
      <ul>
        <li>
          Nothing is done on your behalf without a yes on a card; we keep a record of each one.
        </li>
        <li>
          Some changes need you, for example signing in to a merchant&apos;s site. We&apos;ll tell
          you exactly what&apos;s needed. We never ask for or store your passwords for other
          services.
        </li>
        <li>
          Companies may refuse a request; we&apos;ll tell you if we couldn&apos;t complete
          something.
        </li>
      </ul>

      <h2>Beta</h2>
      <p>
        The service is in a private beta. Features may change, and the service may be interrupted or
        have mistakes. Membership offers during the beta are a test; we&apos;ll tell you before any
        recurring charge.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or older and use accounts that belong to you.</li>
        <li>Keep access to your email secure; sign-in links go there.</li>
        <li>You can stop using the service and delete your data at any time in Settings.</li>
        <li>We may suspend accounts that misuse the service.</li>
      </ul>

      <h2>Referral partners</h2>
      <p>
        Some cards may suggest a partner, such as a savings account or insurance marketplace. When
        we may earn a fee, the card says so before you decide.
      </p>

      <h2>Liability</h2>
      <p>
        We work carefully, but to the extent the law allows, we aren&apos;t liable for indirect
        losses, or for decisions made by banks, merchants or partners.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If these terms change in a way that matters, we&apos;ll ask you to accept the new version.
        Questions: {contactEmail()}.
      </p>
    </LegalPage>
  );
}
