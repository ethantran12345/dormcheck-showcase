import { useLocation } from "react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

const NotFound = () => {
  const { t } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  // Soft-404 guard. `vercel.json` rewrites every unmatched URL to `/index.html`,
  // so a bogus path answers HTTP 200 with the app shell and this component
  // renders underneath it. To a crawler that 200 is a promise that the URL is a
  // real page, so Google indexes junk URLs as real ones. A true 404 status needs
  // a Vercel edge function that knows the route table; until then the honest
  // signal is `noindex`, which Google reads after it renders the page and which
  // makes it drop the URL from the index.
  //
  // Injected imperatively because this app has no head manager (no react-helmet),
  // and torn down on unmount so a client-side navigation from here to a real page
  // does not leave that page marked `noindex`.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t("misc:notFound.title")}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          {t("misc:notFound.returnHome")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
