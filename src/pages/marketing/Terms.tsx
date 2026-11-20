import { LegalBackBar } from "@/components/LegalBackBar";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

export function TermsContent() {
  return (
        <div className="max-w-none">
          <p className="text-xs font-medium uppercase tracking-widest text-malachite-800 mb-4">Legal</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
            Terms of Service
          </h1>
          <p className="text-muted-foreground text-base mb-10 pb-10 border-b border-border">
            Last updated: August 18, 2026. By using DormCheck, you agree to these terms.
          </p>

          <div className="space-y-8 text-foreground">
            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By creating an account, accessing, or using DormCheck (the &quot;Service&quot;), you agree to be bound by these Terms of Service (the &quot;Terms&quot;) and our Privacy Policy. If you do not agree, do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">2. Not Affiliated with Any University</h2>
              <p className="text-muted-foreground leading-relaxed">
                <strong className="text-foreground">DormCheck is a student-built project. It is not affiliated with, endorsed by, sponsored by, or connected to the University of Pittsburgh, Carnegie Mellon University, Carlow University, or any of their housing offices, service desks, or other offices.</strong> All information on the Service is provided for general informational purposes. For official policies, applications, and procedures, refer to your own university&apos;s official websites.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">3. Eligibility</h2>
              <p className="text-muted-foreground leading-relaxed">
                To use DormCheck, you must:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4 mt-2">
                <li>Be at least 18 years old.</li>
                <li>Have a valid student email address issued by a participating university. Participating universities and their accepted email domains are listed on the sign-in page.</li>
                <li>Be a current or incoming student at that university.</li>
                <li>Not be barred from using the Service under applicable law.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">4. Your Account</h2>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
                <li>You are responsible for all activity that occurs under your account.</li>
                <li>You must provide accurate information and keep it current.</li>
                <li>You must notify us immediately at team@dormcheck.com if you suspect unauthorized access to your account.</li>
                <li>You may not share, sell, or transfer your account to anyone else.</li>
                <li>You may not create more than one account per person.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">5. Acceptable Use</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You agree not to:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Use the Service for any unlawful purpose or in violation of any applicable law or regulation.</li>
                <li>Harass, threaten, intimidate, stalk, or impersonate any other person.</li>
                <li>Post content that is defamatory, obscene, pornographic, hateful, discriminatory, or otherwise objectionable.</li>
                <li>Post personally identifying information about minors.</li>
                <li>Post content depicting illegal activity, including illegal drug use or underage drinking.</li>
                <li>Use the Service to advertise, list, or sell illegal items, weapons, controlled substances, or stolen property.</li>
                <li>Send spam, chain messages, or unsolicited promotional content.</li>
                <li>Scrape, crawl, copy, or extract data from the Service using automated means.</li>
                <li>Attempt to gain unauthorized access to other accounts, our systems, or our infrastructure.</li>
                <li>Interfere with, disrupt, or overload the Service.</li>
                <li>Reverse engineer, decompile, or attempt to extract the source code of the Service.</li>
                <li>Use the Service to violate the privacy or intellectual property rights of any third party.</li>
                <li>Offer, request, or arrange academic work for hire. Tutoring on DormCheck means helping another student understand their own work; writing or rewriting an assignment that will be submitted as theirs, sitting an exam, quiz, or proctored assessment for anyone, and selling completed coursework are all prohibited.</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We may remove content and suspend or terminate accounts that violate these rules, at our discretion and without prior notice.
              </p>

              {/*
                Mirrors marketplace:service.integrity.* — the copy a student reads
                when they pick the tutoring category and again on the listing
                itself. This is the same rule stated in the place counsel and the
                universities look for it; change one and change both.
              */}
              <h3 className="text-lg font-semibold mt-6 mb-3 text-foreground">
                Tutoring and academic integrity
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Student services on DormCheck include tutoring. Tutoring is help understanding material: explaining a concept, working through a practice problem, reviewing a draft the student wrote. It is not doing the work. Posts that offer to complete graded work, take an assessment, or sell coursework are removed, and we report them to the university involved. Every university sets its own academic integrity policy and that policy governs; nothing here overrides it, and nothing here is permission to breach it.
              </p>

              {/*
                App Store guideline 1.2: an app with user-generated content must publish
                its filtering method, a report mechanism, a way to block abusive users,
                and contact information, and must act on reports within 24 hours. The
                sign-up EULA checkbox asserts zero tolerance, so this page has to say the
                same thing or the checkbox links to a page that contradicts it.
              */}
              <h3 className="text-lg font-semibold mt-6 mb-3 text-foreground">
                Zero tolerance for objectionable content and abusive users
              </h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                DormCheck has zero tolerance for objectionable content or abusive behavior. Content that violates the rules above has no place on this platform. Every account is required to agree to these terms before it is created.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You can report any listing, post, photo, comment, or message from the item itself, and you can block any user at any time. Blocking removes that person&apos;s content from your view everywhere in the app and prevents them from contacting you.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We review every report and remove violating content, and eject the user who posted it, within 24 hours of the report, often much sooner. Depending on the severity we may also suspend or permanently terminate the account, and we may report serious violations to the relevant university or to law enforcement.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                To report content or an account outside the app, contact us at{' '}
                <a href="mailto:support@dormcheck.com" className="text-primary underline hover:text-primary/90">
                  support@dormcheck.com
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">6. User Content</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                DormCheck lets you post content including profile information, photos, reviews, ratings, listings, messages, and group chat contributions (&quot;User Content&quot;).
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">Ownership:</strong> You retain ownership of your User Content.
                </li>
                <li>
                  <strong className="text-foreground">License to us:</strong> By posting User Content, you grant DormCheck a worldwide, non-exclusive, royalty-free license to host, store, display, reproduce, modify (for formatting), and distribute your User Content solely to operate, improve, and promote the Service. This license ends when you delete your content or your account, except where retention is required for legitimate operational reasons described in our Privacy Policy.
                </li>
                <li>
                  <strong className="text-foreground">Your responsibility:</strong> You represent that you own or have the necessary rights to post your User Content and that it does not infringe any third party&apos;s rights or violate any law.
                </li>
                <li>
                  <strong className="text-foreground">Removal:</strong> We may remove User Content that we believe violates these Terms, applicable law, or the rights of others, at our discretion.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">7. Marketplace</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                DormCheck provides a platform for users to list items and services. <strong className="text-foreground">DormCheck is not a party to any transaction between users.</strong>
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">No vetting:</strong> We do not verify the identity of sellers or buyers beyond the student email authentication gate, the condition of items, or the accuracy of listings.
                </li>
                <li>
                  <strong className="text-foreground">No escrow:</strong> Payments are made directly between users via Venmo, Zelle, cash, or other means. DormCheck does not hold, process, or guarantee payments.
                </li>
                <li>
                  <strong className="text-foreground">Your risk:</strong> All transactions are between users. DormCheck is not responsible for any loss, damage, fraud, misrepresentation, or dispute arising from any transaction. You are responsible for your own due diligence.
                </li>
                <li>
                  <strong className="text-foreground">No taxes or refunds:</strong> Tax obligations and any refunds, returns, or exchanges are entirely between the parties to the transaction.
                </li>
                <li>
                  <strong className="text-foreground">Subleases are shown on a map:</strong> A sublease listing requires an address, and that address is converted to coordinates and displayed as a pin on the sublease map to everyone who can see the listing. Post a sublease only for a place you have the right to sublet, only with an address you are willing to publish, and only if your own lease permits subletting. Whether a sublease is allowed is between you, your landlord, and your university housing contract; DormCheck does not review leases and is not a party to any sublease.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">8. Roommate Matching</h2>
              <p className="text-muted-foreground leading-relaxed">
                DormCheck offers tools to help students find potential roommates based on self-reported lifestyle preferences. <strong className="text-foreground">DormCheck does not perform background checks, identity verification beyond the student email authentication gate, or any vetting of users. Compatibility scores and matching suggestions are informational only.</strong> You are solely responsible for evaluating any potential roommate, communicating directly, meeting in safe public locations, and making your own housing decisions. DormCheck is not liable for any outcome of any roommate arrangement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">9. Third-Party Links and Services</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service may include links to third-party websites, services, or products (including Amazon affiliate links, social media platforms, and external resources). DormCheck does not control and is not responsible for the content, policies, or practices of any third party. Your use of any third-party service is governed by that service&apos;s own terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">10. Intellectual Property</h2>
              <p className="text-muted-foreground leading-relaxed">
                Except for User Content, the Service, including its design, code, logos, graphics, and text, is owned by DormCheck and is protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, or create derivative works of the Service without our prior written permission.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">11. Copyright Complaints</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you believe content on DormCheck infringes your copyright, contact us at team@dormcheck.com with: (a) a description of the copyrighted work, (b) the location of the allegedly infringing content on the Service, (c) your contact information, (d) a statement that you have a good-faith belief that the use is unauthorized, and (e) a statement that the information in your notice is accurate. We will respond promptly to valid notices.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">12. Termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                You may delete your account at any time through your profile settings. We may suspend or terminate your account at our discretion, with or without notice, for any reason including violation of these Terms. Upon termination, the license you granted in Section 6 ends and we will delete your User Content as described in our Privacy Policy. Sections that by their nature should survive termination (including Sections 6, 7, 8, 10, 13, 14, 15, and 16) will survive.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">13. Disclaimers</h2>
              <p className="text-muted-foreground leading-relaxed">
                <strong className="text-foreground">The Service is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any kind, express or implied.</strong> DormCheck disclaims all warranties including merchantability, fitness for a particular purpose, non-infringement, and any warranties arising from course of dealing or usage of trade. We do not warrant that the Service will be uninterrupted, error-free, secure, or that any information on the Service is accurate, complete, or current.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">14. Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                <strong className="text-foreground">To the maximum extent permitted by law, Dormcheck LLC, its member, and team are not liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, goodwill, or other intangible losses, arising from or related to your use of the Service.</strong> Our total liability for any claim arising out of or relating to these Terms or the Service is limited to one hundred US dollars ($100). Some jurisdictions do not allow exclusion or limitation of certain damages, so some of these limits may not apply to you.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">15. Indemnification</h2>
              <p className="text-muted-foreground leading-relaxed">
                You agree to indemnify, defend, and hold harmless Dormcheck LLC, its member, and team from any claims, damages, losses, liabilities, and expenses (including reasonable attorneys&apos; fees) arising out of or related to: (a) your User Content, (b) your use of the Service, (c) your violation of these Terms, or (d) your violation of any rights of a third party.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">16. Governing Law and Disputes</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms are governed by the laws of the Commonwealth of Pennsylvania, without regard to its conflict of laws rules. Any dispute arising out of or relating to these Terms or the Service will be resolved exclusively in the state or federal courts located in Allegheny County, Pennsylvania, and you consent to personal jurisdiction in those courts.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">17. Apple App Store Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you access the Service through the Apple App Store, you acknowledge that these Terms are between you and DormCheck, not Apple. Apple is not responsible for the Service or its content. Apple has no obligation to provide maintenance or support for the Service. In the event the Service fails to conform to any applicable warranty, you may notify Apple, and Apple will refund the purchase price (if any). To the maximum extent permitted by law, Apple has no other warranty obligation with respect to the Service. Apple is a third-party beneficiary of these Terms and may enforce them against you.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">18. Changes to These Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update these Terms from time to time. When we do, we will update the &quot;Last updated&quot; date at the top of this page. Material changes will be communicated through the platform or by email. Your continued use of the Service after changes take effect constitutes acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">19. Miscellaneous</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms and the Privacy Policy are the entire agreement between you and DormCheck regarding the Service. If any provision is found unenforceable, the remaining provisions will remain in effect. Our failure to enforce any right or provision is not a waiver. You may not assign these Terms; we may assign them at our discretion.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">20. Contact</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about these Terms, contact us at team@dormcheck.com.
              </p>
            </section>
          </div>
        </div>
  );
}

const Terms = () => {
  return (
    <div className="min-h-screen bg-tint-50 flex flex-col">
      <RouteMeta title={pageTitle("Terms of Service")} />
      <LegalBackBar />
      {/* Content */}
      <PageContainer width="prose" className="flex-1 px-6 sm:px-8 pt-10 pb-16 md:py-20">
        <TermsContent />
      </PageContainer>
    </div>
  );
};

export default Terms;
