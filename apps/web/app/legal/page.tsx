import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

// DRAFT legal text, grounded in how the product actually works (per-tenant
// Postgres RLS isolation, seat-based Paystack billing, real sub-processors -
// Paystack, Resend, Cloudflare Turnstile, Sentry, S3-compatible storage).
// This has NOT been drafted or reviewed by a lawyer. Bracketed placeholders
// mark facts that need a business/legal decision before publishing for real
// (legal entity name, governing law/jurisdiction, retention periods) - do not
// fill those in with a guess, get them from whoever registers the company.
const LAST_UPDATED = "September 2026";

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold text-gray-900 mt-6">{children}</h3>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-600 mt-2 leading-relaxed">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc pl-5 text-gray-600 mt-2 space-y-1 leading-relaxed">
      {children}
    </ul>
  );
}

export default function LegalPage() {
  return (
    <div className="bg-white">
      <MarketingHeader />

      <div className="max-w-3xl mx-auto px-6 py-16 sm:py-24">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Legal</h1>
        {/* <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm text-amber-800">
            <strong>Draft pending legal review.</strong> The Terms of Service and Privacy Policy below have not been
            drafted or reviewed by a lawyer. They describe how Oudmed actually works today, but should not be treated
            as a binding legal document until reviewed by counsel familiar with Nigerian data protection law (NDPR).
            Last updated: {LAST_UPDATED}.
          </p>
        </div> */}

        {/* ─────────────────────────── Accessibility ─────────────────────────── */}
        <section id="accessibility" className="mt-12 scroll-mt-24">
          <h2 className="text-xl font-bold text-gray-900">Accessibility</h2>
          <P>
            Oudmed aims to be usable by hospital staff of all abilities, across
            the roles the product serves - reception, nursing, clinical,
            pharmacy, lab, billing, and administrative staff. If you run into an
            accessibility barrier anywhere in the product, contact us at the
            details below and we&apos;ll look into it.
          </P>
        </section>

        {/* ─────────────────────────── Terms of Service ─────────────────────────── */}
        <section id="terms" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-gray-900">Terms of Service</h2>
          <P>
            These Terms of Service (&quot;Terms&quot;) govern access to and use
            of Oudmed, a multi-tenant hospital management platform provided by{" "}
            <strong>Oud Technologies Limited</strong> (&quot;Oudmed&quot;,
            &quot;we&quot;, &quot;us&quot;). By creating a hospital account or
            otherwise using Oudmed, the hospital entering into these Terms
            (&quot;Customer&quot;, &quot;you&quot;) agrees to them.
          </P>

          <H3>1. The Service</H3>
          <P>
            Oudmed is a subscription hospital management system covering patient
            records, scheduling and admissions, clinical encounters, pharmacy
            inventory and dispensing, billing and HMO/insurance claims, human
            resources, administration, and reporting. Each hospital&apos;s data
            is logically separated from every other hospital&apos;s data at the
            database level (Postgres Row-Level Security, enforced by a
            restricted database role with no ability to bypass it) - no hospital
            can access another hospital&apos;s records through the product.
          </P>

          <H3>2. Accounts and Roles</H3>
          <P>
            The person who signs up creates the hospital&apos;s account and
            becomes its first Hospital Admin. The Hospital Admin is responsible
            for creating and deactivating staff accounts (Doctor, Nurse,
            Reception, Pharmacist, Lab Staff, Accountant, and additional
            Hospital Admin roles) and for what those accounts do inside the
            hospital&apos;s workspace. You are responsible for keeping login
            credentials confidential and for all activity under your
            hospital&apos;s accounts.
          </P>

          <H3>3. Subscription, Fees, and Billing</H3>
          <P>
            Oudmed is billed per seat (an admin-seat rate plus a
            per-additional-user rate), monthly or annually, with a discount for
            annual billing. New hospitals get a 14-day trial. Card payments are
            processed by Paystack; bank transfer is also available and confirmed
            manually. If a subscription lapses, the hospital&apos;s existing
            data remains visible, but creating new records (patients,
            appointments, prescriptions, invoices, and similar) is blocked until
            billing is brought current - we do not delete a hospital&apos;s data
            for non-payment. Fees are <strong>non-refundable,</strong> except
            where required by law.
          </P>

          <H3>4. Your Data, Your Responsibility</H3>
          <P>
            As between Oudmed and the Customer, the Customer owns the patient,
            staff, and operational data it enters into the platform. For patient
            health data specifically, the hospital is the data controller and
            Oudmed acts as a data processor, processing that data only to
            provide the service and on the hospital&apos;s instructions. The
            hospital is responsible for:
          </P>
          <UL>
            <li>the accuracy of data its staff enter into Oudmed;</li>
            <li>
              obtaining any patient consent required to record and process their
              health information;
            </li>
            <li>
              its own compliance with applicable healthcare, licensing, and data
              protection law (including NDPR);
            </li>
            <li>what its staff do with the access the hospital grants them.</li>
          </UL>

          <H3>5. Acceptable Use</H3>
          <P>You agree not to, and not to permit others to:</P>
          <UL>
            <li>
              use Oudmed to store or process data for a hospital or patients
              other than your own without authorization;
            </li>
            <li>
              attempt to access another hospital&apos;s data or bypass tenant
              isolation;
            </li>
            <li>
              reverse-engineer, resell, or white-label the platform without a
              separate written agreement;
            </li>
            <li>
              use the service in a way that violates applicable law, including
              healthcare and data protection law.
            </li>
          </UL>

          <H3>6. Third-Party Services</H3>
          <P>
            Oudmed relies on a small number of third-party providers to operate:
            Paystack (payment processing), Resend (transactional email -
            verification codes, password resets, billing notices, contact form
            replies), Cloudflare Turnstile (bot protection on the public contact
            form), Sentry (error monitoring), and an S3-compatible object
            storage provider (uploaded documents and images). Their processing
            of data on our behalf is governed by their own terms and our
            agreements with them.
          </P>

          <H3>7. Service Availability</H3>
          <P>
            We aim to keep Oudmed available and performant but do not currently
            offer a formal uptime service-level agreement. Planned maintenance
            and, rarely, unplanned downtime may occur. A platform-wide
            maintenance mode may be enabled to protect data integrity during
            incidents; hospitals are shown a maintenance notice during that time
            rather than an error.
          </P>

          <H3>8. Termination</H3>
          <P>
            You may stop using Oudmed at any time. We may suspend or terminate a
            hospital&apos;s access for material breach of these Terms,
            non-payment beyond the read-only grace period described above, or
            fraudulent or unlawful use. On termination, the hospital may request
            an export of its data within <strong>30 days</strong>, after which
            it may be deleted.
          </P>

          <H3>9. Disclaimers and Limitation of Liability</H3>
          <P>
            Oudmed is a records and workflow management tool. It does not
            provide medical advice, and is not a substitute for the clinical
            judgment of qualified healthcare professionals. The service is
            provided &quot;as is&quot; without warranties of any kind beyond
            those that cannot be excluded by law. To the maximum extent
            permitted by law, Oudmed&apos;s aggregate liability for any claim
            arising from these Terms is limited to{" "}
            <strong>fees paid by customer in the preceding 12 months</strong>.
          </P>

          <H3>10. Governing Law</H3>
          <P>
            These Terms are governed by the laws of{" "}
            <strong>the Federal Republic of Nigeria</strong>, without regard to
            conflict-of-law principles.
          </P>

          <H3>11. Changes to These Terms</H3>
          <P>
            We may update these Terms from time to time. Material changes will
            be notified to hospital admins by email or in-product notice before
            taking effect.
          </P>
        </section>

        {/* ─────────────────────────── Privacy Policy ─────────────────────────── */}
        <section id="privacy" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-gray-900">Privacy Policy</h2>
          <P>
            This Privacy Policy explains what data Oudmed collects, why, and how
            it is protected. It covers both the hospitals and staff who use the
            product, and visitors to this marketing website.
          </P>

          <H3>1. Our Role: Controller vs. Processor</H3>
          <P>
            For patient health data entered into the product by a
            hospital&apos;s staff, the hospital is the data controller and
            Oudmed is the data processor, acting only on the hospital&apos;s
            instructions. For data about the hospital itself and its staff
            accounts (signup details, billing contacts, support requests) and
            for visitors to this marketing website (e.g. the contact form),
            Oudmed is the data controller.
          </P>

          <H3>2. What We Collect</H3>
          <P>
            <strong>Hospital and staff account data:</strong> name, email,
            phone, role, and department for each staff account a hospital
            creates; the hospital&apos;s name, address, and branding.
          </P>
          <P>
            <strong>Patient data:</strong> whatever a hospital&apos;s staff
            enter - demographics, contact and next-of-kin details,
            insurance/payer information, vital signs, complaints, diagnoses,
            prescriptions, lab orders and results, admissions, and billing
            records tied to a visit. This is entered and controlled entirely by
            the hospital, not by us.
          </P>
          <P>
            <strong>Billing data:</strong> subscription plan, seat count,
            invoice and payment records. Card details are handled directly by
            Paystack - Oudmed does not store card numbers.
          </P>
          <P>
            <strong>Marketing site data:</strong> if you submit the Contact Us
            form, we collect your name, email, phone, and message to respond to
            your inquiry. That submission is protected by spam-prevention checks
            (Cloudflare Turnstile, rate limiting, and basic content checks)
            before it reaches us.
          </P>
          <P>
            <strong>Technical data:</strong> error and performance data captured
            by Sentry when something goes wrong, to help us fix it - this can
            include the page/action involved and a stack trace, not patient
            record contents by design.
          </P>

          <H3>3. How We Use It</H3>
          <UL>
            <li>
              To provide, maintain, and secure the service a hospital has
              subscribed to;
            </li>
            <li>
              to process payments and send billing-related notices (payment
              received/failed, trial ending);
            </li>
            <li>to verify accounts and support password resets;</li>
            <li>to respond to support and contact form inquiries;</li>
            <li>to monitor and fix errors in the product;</li>
            <li>to meet legal obligations.</li>
          </UL>
          <P>
            We do not sell personal data, and we do not use patient data for
            advertising.
          </P>

          <H3>4. Who We Share Data With</H3>
          <P>
            We share data only with the service providers needed to run Oudmed,
            and, for patient data, only as a hospital's staff direct through the
            product itself (for example, generating an HMO claim shares the
            relevant visit and billing data with that patient's chosen insurance
            provider, because the hospital's staff initiated that claim):
          </P>
          <UL>
            <li>
              <strong>Paystack</strong> - payment processing for subscription
              billing;
            </li>
            <li>
              <strong>Resend</strong> - delivery of transactional emails
              (verification, password reset, billing notices, contact replies);
            </li>
            <li>
              <strong>Cloudflare</strong> - bot/spam protection on the public
              contact form;
            </li>
            <li>
              <strong>Sentry</strong> - error monitoring;
            </li>
            <li>
              our object storage provider - hosting uploaded documents, photos,
              and logos;
            </li>
            <li>
              HMO/insurance providers - only for claims a hospital's own staff
              generate and submit through the Claims module.
            </li>
          </UL>
          <P>
            We do not sell or rent personal data to third parties for their own
            marketing purposes.
          </P>

          <H3>5. How We Protect It</H3>
          <UL>
            <li>
              Every hospital's data is isolated at the database level via
              PostgreSQL Row-Level Security, enforced through a restricted,
              non-superuser database role - not just by application-level
              checks;
            </li>
            <li>
              uploaded files can be scanned for malware before being made
              available, where malware scanning is enabled;
            </li>
            <li>
              file access uses short-lived, one-time links rather than
              permanently public URLs;
            </li>
            <li>
              staff access within a hospital is role-based (e.g. pharmacy staff,
              lab staff, and billing staff see only what their role needs).
            </li>
          </UL>

          <H3>6. Data Retention</H3>
          <P>
            We retain hospital and patient data for as long as the hospital's
            subscription is active, and for <strong>30 days</strong> after
            termination to allow data export, unless a longer period is required
            by law or the hospital requests earlier deletion.
          </P>

          {/* <H3>7. International Data Transfers</H3>
          <P>
            <strong>[To be completed once hosting/region is finalized - state where data is hosted and, if outside
            Nigeria, what safeguards apply under NDPR for that transfer.]</strong>
          </P> */}

          <H3>8. Your Rights</H3>
          <P>
            Depending on applicable law (including the Nigeria Data Protection
            Regulation), you may have the right to access, correct, export, or
            request deletion of your personal data. For patient data, that
            request should generally go to the hospital that treated you, as the
            data controller; for account or marketing-site data we hold
            directly, contact us using the details below.
          </P>

          <H3>9. Cookies</H3>
          <P>
            Oudmed uses a session cookie to keep you signed in. We do not
            currently use advertising or cross-site tracking cookies on the
            marketing site.
          </P>

          <H3>10. Children&apos;s Data</H3>
          <P>
            Oudmed is not directed at children and is not used by them directly.
            Patient records may include minors where a hospital treats pediatric
            patients; in that case, the hospital is responsible for obtaining
            appropriate parental or guardian consent as the data controller.
          </P>

          <H3>11. Changes to This Policy</H3>
          <P>
            We may update this Privacy Policy from time to time. Material
            changes will be notified to hospital admins by email or in-product
            notice before taking effect.
          </P>
        </section>

        {/* ─────────────────────────── Legal Notices ─────────────────────────── */}
        <section id="notices" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-bold text-gray-900">Legal Notices</h2>
          <P>&copy; {new Date().getFullYear()} Oudmed. All rights reserved.</P>
          <P>
            Questions about these Terms or this Privacy Policy can be sent to{" "}
            <a
              href="mailto:info@Oudtechnologies.com"
              className="text-primary underline"
            >
              info@Oudtechnologies.com
            </a>{" "}
            or +234 805 295 2194.
          </P>
        </section>
      </div>

      <MarketingFooter />
    </div>
  );
}
