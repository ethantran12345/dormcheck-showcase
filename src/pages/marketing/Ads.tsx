import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Store } from "lucide-react";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";
const Ads = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <RouteMeta title={pageTitle("Local Business Portal")} />
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
        <PageContainer width="prose" className="px-4 sm:px-6 py-4">
          <Link to="/">
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </PageContainer>
      </div>

      <PageContainer width="prose" className="flex-1 px-4 sm:px-6 py-10 md:py-16">
        <div className="flex items-center gap-3 mb-8">
          <Store className="w-10 h-10 text-primary" />
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-[hsl(200,38%,27%)] to-malachite-600 bg-clip-text text-transparent">
            Local Business Portal
          </h1>
        </div>

        <p className="text-muted-foreground text-lg mb-8">
          Reach Pitt students through DormCheck. Partner with us to promote your business to the campus community.
        </p>

        <div className="space-y-6 text-foreground prose prose-slate max-w-none">
          <section>
            <h2 className="text-2xl font-bold mb-4 text-foreground">Why Partner With DormCheck?</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              DormCheck connects directly with University of Pittsburgh students searching for housing, furniture, roommates, and off-campus resources. If your business serves students - whether you&apos;re a furniture store, moving company, or landlord - we can help you reach them.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-foreground">Get In Touch</h2>
            <p className="text-muted-foreground leading-relaxed">
              Interested in advertising or partnerships? Email us at{" "}
              <a href="mailto:ads@dormcheck.com" className="text-primary underline hover:text-primary/90">
                ads@dormcheck.com
              </a>
              .
            </p>
          </section>
        </div>
      </PageContainer>
    </div>
  );
};

export default Ads;
