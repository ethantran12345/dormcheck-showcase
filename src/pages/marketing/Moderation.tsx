import { LegalBackBar } from "@/components/LegalBackBar";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

export function ModerationContent() {
  return (
        <div className="max-w-none">
          <p className="text-xs font-medium uppercase tracking-widest text-malachite-800 mb-4">Legal</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
            Moderation Guidelines
          </h1>
          <p className="text-muted-foreground text-base mb-10 pb-10 border-b border-border">
            Last updated: August 1, 2026
          </p>
          <p className="text-muted-foreground text-base mb-10">
            These guidelines cover what belongs on DormCheck and how we handle content that does not. They apply to every verified Pitt student using the platform.
          </p>

          <div className="space-y-8 text-foreground">
            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">1. Community Standards</h2>
              <p className="text-muted-foreground leading-relaxed">
                DormCheck is a community for verified University of Pittsburgh students. All content you post (reviews, marketplace listings, roommate profiles, and comments) must be respectful, honest, and free of harassment, spam, or illegal activity.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">2. Prohibited Content</h2>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Hate speech, discrimination, or harassment</li>
                <li>Spam, scams, or misleading listings</li>
                <li>Personal attacks or doxxing</li>
                <li>Off-topic or duplicate content</li>
                <li>Content that violates Pitt&apos;s Student Code of Conduct</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">3. Marketplace Listings</h2>
              <p className="text-muted-foreground leading-relaxed">
                Listings must accurately describe the items being sold. We reserve the right to remove listings that appear fraudulent, misleading, or inappropriate. Repeat violations may result in account restrictions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">4. Reporting and enforcement</h2>
              {/*
                App Store guideline 1.2 requires a published 24-hour turnaround on
                objectionable-content reports (remove the content, eject the user), and
                the sign-up EULA checkbox asserts zero tolerance. This wording has to
                match Terms.tsx section 5; change them together.
              */}
              <p className="text-muted-foreground leading-relaxed mb-4">
                DormCheck has zero tolerance for objectionable content or abusive users. If you see content that violates these guidelines, report it from the item itself, or contact us at{" "}
                <a href="mailto:support@dormcheck.com" className="text-primary underline hover:text-primary/90">
                  support@dormcheck.com
                </a>
                .
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We act on every report within 24 hours. Violating content is removed and the user who posted it is ejected from the platform; depending on severity, we may suspend or permanently terminate the account. We may report serious violations to the user&apos;s university or to authorities when appropriate.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                You can also block any user at any time from their profile or from any of their content. Blocking is immediate and applies everywhere in the app.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">5. Enforcement</h2>
              <p className="text-muted-foreground leading-relaxed">
                Violations may result in content removal, temporary suspension, or permanent account termination. We may also report serious violations to the University of Pittsburgh or authorities when appropriate.
              </p>
            </section>
          </div>
        </div>
  );
}

const Moderation = () => {
  return (
    <div className="min-h-screen bg-tint-50 flex flex-col">
      <RouteMeta title={pageTitle("Moderation Guidelines")} />
      <LegalBackBar />
      {/* Content */}
      <PageContainer width="prose" className="flex-1 px-6 sm:px-8 pt-10 pb-16 md:py-20">
        <ModerationContent />
      </PageContainer>
    </div>
  );
};

export default Moderation;
