/**
 * Privacy policy. This is generated to reflect the data the application
 * ACTUALLY collects (see prisma/schema.prisma) — keep it in sync when the
 * data model changes. Have legal counsel review before production use.
 */
export default function PrivacyPage() {
  const updated = '2026-05-21';
  return (
    <main className="container">
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: {updated}</p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> name, email address, organization
          name and domain, assigned role.
        </li>
        <li>
          <strong>Authentication data:</strong> a salted password hash (argon2id
          — we never store your password), and, if you enable MFA, an encrypted
          TOTP secret.
        </li>
        <li>
          <strong>Session &amp; security data:</strong> session identifiers, IP
          address and user-agent at sign-in, and timestamps of administrative
          actions recorded in an audit log.
        </li>
        <li>
          <strong>Billing data:</strong> subscription plan and status. Card
          details are handled entirely by Stripe; we never see or store them.
        </li>
      </ul>

      <h2>2. Why we process it</h2>
      <p>
        To provide and secure the service, authenticate you, enforce access
        controls, process subscription billing, and meet legal and audit
        obligations. The lawful bases are contract performance and our
        legitimate interest in operating a secure service.
      </p>

      <h2>3. Sub-processors</h2>
      <ul>
        <li>Stripe — payment processing</li>
        <li>Resend — transactional email delivery</li>
        <li>Our cloud hosting and managed database provider</li>
      </ul>

      <h2>4. Retention</h2>
      <p>
        Account data is retained while your account is active. Audit logs are
        retained for the period configured by your organization (default 7
        years). On account or organization deletion, associated data is removed
        by cascade, subject to any legal hold.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You may export your personal data at any time
        (<code>/api/account/export</code>) and delete your account
        (<code>/api/account/delete</code>). Under the GDPR you also have rights
        of access, rectification, restriction, and objection — contact your
        organization administrator or our privacy contact.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We set one strictly-necessary cookie to keep you signed in. Analytics
        cookies are only set after you opt in via the consent banner.
      </p>

      <p>
        <a href="/">← Back</a>
      </p>
    </main>
  );
}
