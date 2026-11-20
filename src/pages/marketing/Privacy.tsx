import { LegalBackBar } from "@/components/LegalBackBar";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

export function PrivacyContent() {
  return (
        <div className="max-w-none">
          <p className="text-xs font-medium uppercase tracking-widest text-malachite-800 mb-4">Legal</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground text-base mb-10 pb-10 border-b border-border">
            Last updated: August 18, 2026
          </p>
          <p className="text-muted-foreground text-base mb-10">
            DormCheck is a student-built platform restricted to verified students at participating universities. This policy explains what we collect, how we use it, and what your choices are.
          </p>

          <div className="space-y-8 text-foreground">
            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">1. Who We Are</h2>
              <p className="text-muted-foreground leading-relaxed">
                Dormcheck LLC (&quot;DormCheck,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a verified student housing platform operated by Dormcheck LLC. We are not affiliated with any university. You can reach us at team@dormcheck.com for any privacy-related questions, requests, or concerns.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">2. Eligibility</h2>
              <p className="text-muted-foreground leading-relaxed">
                DormCheck is available only to verified students at participating universities who are 18 or older and have a valid university-issued student email address. DormCheck is not directed to children, and you must be at least 18 to use it. We do not knowingly collect personal information from anyone under 18. If you believe we have collected information from someone under 18, contact team@dormcheck.com and we will delete it.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">3. Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We collect only what we need to operate the platform. Categories include:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">Account information:</strong> Your university-issued student email address, used to verify student status and authenticate your account. You may sign in with email and password or with Google. We never store your password in plain text; passwords are hashed by our authentication provider.
                </li>
                <li>
                  <strong className="text-foreground">Profile information:</strong> Display name, profile photo, bio, major, academic year, dorm assignment (self-reported), and any other details you choose to add.
                </li>
                <li>
                  <strong className="text-foreground">Roommate matching preferences:</strong> Lifestyle preferences you submit, such as sleep schedule, cleanliness, study habits, and similar attributes used to match you with potential roommates.
                </li>
                <li>
                  <strong className="text-foreground">Marketplace listings:</strong> Photos, descriptions, prices, and metadata for any items or services you list. If you choose to display them, Venmo or Zelle handles for payment coordination.
                </li>
                <li>
                  <strong className="text-foreground">Phone number (optional):</strong> If you choose to share a phone number on your roommate profile or marketplace listing, we store it and display it according to your visibility toggles. Phone numbers are never shown publicly unless you opt in.
                </li>
                <li>
                  <strong className="text-foreground">Address information:</strong> For marketplace listings and roommate search posts, you may enter a building name or street address (e.g., "3400 Forbes Ave" or "Litchfield Towers") so other students can identify the location. This is displayed with the listing or post. For a sublease the address is required, and we send it to our mapping provider to convert it into coordinates so the listing can be shown on the sublease map.
                </li>
                <li>
                  <strong className="text-foreground">Social handles (optional):</strong> Instagram or Snapchat usernames if you choose to link them. These are shown on your listings or roommate cards only if you toggle them visible.
                </li>
                <li>
                  <strong className="text-foreground">Housing activity:</strong> Saved dorms, custom rankings, ranking group memberships, and contributions to shared move-in checklists with roommates.
                </li>
                <li>
                  <strong className="text-foreground">Class schedule (optional):</strong> If you add classes, we store the course label (e.g., "CHEM 0110 LEC"), meeting days and times, building, room, and term so you can view and share your schedule. You control what you add.
                </li>
                <li>
                  <strong className="text-foreground">Reviews and ratings:</strong> Dorm reviews, dining ratings, and similar content you post.
                </li>
                <li>
                  <strong className="text-foreground">Messages and group chats:</strong> Direct messages, building or floor group chat content, and collaboration group activity.
                </li>
                <li>
                  <strong className="text-foreground">Usage signals:</strong> Hearts, saves, and similar interaction events used to surface relevant content.
                </li>
                <li>
                  <strong className="text-foreground">Technical information:</strong> IP address, browser or device type, operating system, and similar data your device sends when you use the platform. This is logged for security, abuse prevention, and basic operational metrics.
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We do not collect real-time location data, payment card information, or any data classified as protected health information. Sublease coordinates come from the address you type, never from your device's location.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">4. How We Use Your Information</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We use the information above to:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Authenticate your account and confirm your student status through your university-issued student email.</li>
                <li>Display your profile, listings, and contributions to other verified students.</li>
                <li>Match you with potential roommates based on lifestyle preferences.</li>
                <li>Operate the marketplace, checklist, group chat, and review features.</li>
                <li>Send transactional emails (sign-in, account changes, password reset, notifications).</li>
                <li>Detect and prevent abuse, fraud, and security incidents.</li>
                <li>Improve the platform based on aggregate, non-identifying usage patterns.</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We do not use your data to train AI models, build advertising profiles, or sell to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">5. Who Sees Your Information</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Visibility on the platform works as follows:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">Other verified students at your university:</strong> Can see your profile, public listings, ratings, public reviews, and any content you post.
                </li>
                <li>
                  <strong className="text-foreground">Verified students at partner schools in your area:</strong> Some universities participate in a shared local marketplace. Where they do, verified students at those schools can see your marketplace listings, your seller ratings, and the name and photo on your public profile, and may send you a message request that you can accept or decline. You can only post listings to your own university. Partner schools, where any, are shown on the marketplace.
                </li>
                <li>
                  <strong className="text-foreground">Group members only:</strong> Group chat content, checklist contributions, and ranking group activity are visible only to members of those groups.
                </li>
                <li>
                  <strong className="text-foreground">Recipient only:</strong> Direct messages are visible only to the sender and recipient.
                </li>
                <li>
                  <strong className="text-foreground">Public:</strong> Dorm reviews and ratings may be viewable to anyone who can see the relevant building page within the platform.
                </li>
                <li>
                  <strong className="text-foreground">Shown on a map:</strong> If you post a sublease, the address you enter is converted to map coordinates and your listing is shown as a pin on the sublease map, alongside the rent, dates, and photos you provided. Anyone who can see the listing can see where it is. If you do not want an address shown on a map, do not post a sublease.
                </li>
                <li>
                  <strong className="text-foreground">Hidden by default:</strong> Venmo / Zelle handles and social handles are not shown publicly unless you explicitly choose to display them on a specific listing.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">6. Service Providers</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We use a small number of trusted service providers to operate the platform. These providers process data only on our behalf and only as needed to deliver their services:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">Supabase:</strong> Database, authentication, file storage, and real-time messaging infrastructure. Hosts your account, profile, listings, photos, and messages.
                </li>
                <li>
                  <strong className="text-foreground">Google:</strong> If you choose to sign in with Google, Google handles authentication. Google sees your email address and basic profile information you have shared with them.
                </li>
                <li>
                  <strong className="text-foreground">Resend:</strong> Transactional email delivery (sign-in codes, notifications, password resets).
                </li>
                <li>
                  <strong className="text-foreground">Mapbox:</strong> Map tiles and geocoding for dorm location displays. Mapbox may see your IP address when map content loads.
                </li>
                <li>
                  <strong className="text-foreground">Vercel and Cloudflare:</strong> Web hosting, content delivery, and DDoS protection. Standard web traffic logs.
                </li>
                <li>
                  <strong className="text-foreground">Vercel Analytics:</strong> Privacy-friendly, aggregate page-view and traffic measurement. Collects anonymized page views and basic device and referrer signals to help us understand overall usage. It does not use cross-site tracking cookies or build advertising profiles.
                </li>
                <li>
                  <strong className="text-foreground">Amazon Associates:</strong> When you click affiliate links to Amazon products, Amazon may set cookies or tracking parameters. We receive a small commission on qualifying purchases. We do not share your DormCheck profile with Amazon.
                </li>
                <li>
                  <strong className="text-foreground">Apple:</strong> If you use the iOS app, Apple delivers the app and may collect crash reports and similar diagnostics per their standard policies.
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We do not sell, rent, or share your personal information with advertisers, data brokers, or unrelated third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">7. Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                We protect your data with industry-standard practices including encryption in transit (HTTPS) and at rest, row-level access controls on our database, password hashing handled by our authentication provider, and the student email verification gate that restricts access to other verified students. No system is perfectly secure, but we take this seriously and respond promptly to credible security reports sent to team@dormcheck.com.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">8. Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed">
                We retain your account information for as long as your account is active. If you delete your account, we delete your profile, listings, messages, and associated content from our active systems within 30 days. Some information may persist briefly in encrypted backups for up to 90 days before being purged. Aggregate, non-identifying analytics may be retained indefinitely.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">9. Your Rights and Choices</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You can:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">Access and update</strong> your profile, listings, and content directly within the app.
                </li>
                <li>
                  <strong className="text-foreground">Delete your account</strong> at any time through your profile settings. Account deletion removes your profile, listings, messages, and associated content as described in Section 8.
                </li>
                <li>
                  <strong className="text-foreground">Control visibility</strong> of your social handles, Venmo, and Zelle through the toggles on your profile and listings.
                </li>
                <li>
                  <strong className="text-foreground">Request a copy</strong> of your data by emailing team@dormcheck.com.
                </li>
                <li>
                  <strong className="text-foreground">Withdraw consent</strong> by deleting your account.
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Depending on where you live, you may have additional rights under laws such as the California Consumer Privacy Act (CCPA) or the EU General Data Protection Regulation (GDPR). To exercise any such right, contact us at team@dormcheck.com and we will respond within a reasonable time.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">10. Cookies and Tracking</h2>
              <p className="text-muted-foreground leading-relaxed">
                DormCheck uses essential cookies and similar local storage to keep you signed in and remember your preferences. We do not use third-party advertising cookies or cross-site tracking. Amazon affiliate links use tracking parameters described in Section 6.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">11. Changes to This Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. When we do, we will update the &quot;Last updated&quot; date at the top of this page. Material changes will be communicated through the platform or by email.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">12. Contact</h2>
              <p className="text-muted-foreground leading-relaxed">
                For privacy questions, requests, or concerns, contact us at team@dormcheck.com.
              </p>
            </section>
          </div>
        </div>
  );
}

const Privacy = () => {
  return (
    <div className="min-h-screen bg-tint-50 flex flex-col">
      {/* Title/canonical live on the page, not on PrivacyContent — the content
          is also rendered inline inside Settings, which owns its own title. */}
      <RouteMeta title={pageTitle("Privacy Policy")} />
      <LegalBackBar />
      {/* Content */}
      <PageContainer width="prose" className="flex-1 px-6 sm:px-8 pt-10 pb-16 md:py-20">
        <PrivacyContent />
      </PageContainer>
    </div>
  );
};

export default Privacy;
