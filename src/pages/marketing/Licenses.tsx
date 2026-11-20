import { LegalBackBar } from "@/components/LegalBackBar";
import licenseData from "@/data/licenses.generated.json";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

/**
 * Open-source acknowledgements (`/licenses`). Lists the third-party packages
 * DormCheck's app is built with and their licenses, rendered from
 * `src/data/licenses.generated.json` - generated from the real installed
 * production dependency tree by `scripts/generate-licenses.mjs`. Mounted in
 * LegalRoutes so it's reachable in-app on web AND native, like /terms and
 * /privacy. Nothing here is hand-authored, so re-running the generator keeps
 * the page honest as dependencies change.
 */
export function LicensesContent() {
  const { packages, count } = licenseData;

  return (
        <div className="max-w-none">
          <p className="text-xs font-medium uppercase tracking-widest text-malachite-800 mb-4">Legal</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
            Open-source licenses
          </h1>
          <p className="text-muted-foreground text-base mb-10 pb-10 border-b border-border">
            DormCheck is built with {count} open-source packages. We&apos;re grateful to their
            authors and maintainers. Each package below is used under its own license; follow a
            link to read the full terms.
          </p>

          <ul className="space-y-3">
            {packages.map((pkg) => (
              <li
                key={pkg.name}
                className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={pkg.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sm text-foreground underline decoration-transparent underline-offset-2 hover:decoration-malachite-800 focus-visible:decoration-malachite-800 break-words"
                  >
                    {pkg.name}
                  </a>
                  <p className="mt-0.5 text-xs text-muted-foreground">v{pkg.version}</p>
                </div>
                <span className="shrink-0 rounded-full bg-malachite-600/10 px-2.5 py-1 text-xs font-medium text-malachite-800">
                  {pkg.license}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-10 pt-8 border-t border-border text-xs text-muted-foreground leading-relaxed">
            This list covers the direct production dependencies DormCheck declares. License
            identifiers follow the SPDX format reported by each package. Generated from the
            installed dependency tree - see{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">scripts/generate-licenses.mjs</code>.
          </p>
        </div>
  );
}

const Licenses = () => {
  return (
    <div className="min-h-screen bg-tint-50 flex flex-col">
      <RouteMeta title={pageTitle("Open-source licenses")} />
      <LegalBackBar />
      <PageContainer width="prose" className="flex-1 px-6 sm:px-8 pt-10 pb-16 md:py-20">
        <LicensesContent />
      </PageContainer>
    </div>
  );
};

export default Licenses;
