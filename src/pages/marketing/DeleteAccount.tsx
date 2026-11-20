import { LegalBackBar } from "@/components/LegalBackBar";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

export function DeleteAccountContent() {
  return (
        <div className="max-w-none">
          <p className="text-xs font-medium uppercase tracking-widest text-malachite-800 mb-4">Account</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
            Delete Your Account
          </h1>
          <p className="text-muted-foreground text-base mb-10 pb-10 border-b border-border">
            You can permanently delete your DormCheck account and its data at any time, directly from the app. This page explains how.
          </p>

          <div className="space-y-8 text-foreground">
            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">Steps to delete your account</h2>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground ml-4">
                <li>
                  <strong className="text-foreground">Sign in</strong> to DormCheck with your @pitt.edu account, on the mobile app or at dormcheck.com.
                </li>
                <li>
                  <strong className="text-foreground">Open Settings</strong> from your profile.
                </li>
                <li>
                  <strong className="text-foreground">Tap &quot;Delete My Account&quot;</strong> and confirm when prompted.
                </li>
              </ol>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Deletion is permanent and cannot be undone. If you cannot sign in to reach Settings, email{" "}
                <a href="mailto:team@dormcheck.com" className="text-malachite-800 underline underline-offset-2">team@dormcheck.com</a>{" "}
                from your @pitt.edu address and we will process the deletion for you.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">What gets deleted</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Deleting your account removes your personal data and the content tied to it, including:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Your profile: display name, photo, bio, major, academic year, and dorm assignment.</li>
                <li>Your marketplace listings and their photos.</li>
                <li>Your roommate matching profile and lifestyle preferences.</li>
                <li>Your direct messages and group chat participation.</li>
                <li>Your saved dorms, custom rankings, and checklist contributions.</li>
                <li>Your reviews, ratings, and class schedule entries.</li>
                <li>Your account credentials and contact details.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">Data retention windows</h2>
              <p className="text-muted-foreground leading-relaxed">
                When you delete your account, we delete your profile, listings, messages, and associated content from our active systems within 30 days. Some information may persist briefly in encrypted backups for up to 90 days before being purged. Aggregate, non-identifying analytics that cannot be linked back to you may be retained indefinitely. This mirrors Section 8 of our{" "}
                <a href="/privacy" className="text-malachite-800 underline underline-offset-2">Privacy Policy</a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-foreground">Questions</h2>
              <p className="text-muted-foreground leading-relaxed">
                For any question about deleting your account or your data, contact us at{" "}
                <a href="mailto:team@dormcheck.com" className="text-malachite-800 underline underline-offset-2">team@dormcheck.com</a>.
              </p>
            </section>
          </div>
        </div>
  );
}

const DeleteAccount = () => {
  return (
    <div className="min-h-screen bg-tint-50 flex flex-col">
      <RouteMeta title={pageTitle("Delete Your Account")} />
      <LegalBackBar />
      {/* Content */}
      <PageContainer width="prose" className="flex-1 px-6 sm:px-8 pt-10 pb-16 md:py-20">
        <DeleteAccountContent />
      </PageContainer>
    </div>
  );
};

export default DeleteAccount;
