import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * Public marketing top nav (logged-out web only), marketing site 2026-07.
 *
 * `LayoutWrapper` (`src/App.tsx`) renders this instead of the app `GlobalTopNav`
 * when the visitor is signed out on web. Fixed over the page: flat and
 * transparent at the top of the landing hero, and past 24px of scroll it
 * becomes a centered floating white pill. Non-landing marketing pages get a
 * spacer below the fixed bar. Tabs are real pages (mockup 2026-07); a single
 * "Get started" CTA goes to /auth (signed-in visitors get "Go to app").
 * Below md the tabs collapse into a hamburger disclosure panel.
 */
const NAV_LINKS = [
  { label: "For students", to: "/for-students" },
  { label: "For universities", to: "/for-universities" },
  { label: "Partners", to: "/partners" },
  { label: "About", to: "/about" },
] as const;

export function MarketingTopNav() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isLanding = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile panel on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <header className={cn("fixed inset-x-0 top-0 z-50 px-4 transition-all duration-300 sm:px-6", scrolled && "pt-3.5")}>
        <div
          className={cn(
            // rounded-pill: the capsule nav bar is deliberately full-round, so this is
            // the pill tier expressed as a token instead of raw Tailwind — same value.
            "mx-auto flex items-center justify-between rounded-pill border border-transparent transition-all duration-300",
            scrolled || menuOpen
              ? "h-[60px] max-w-[980px] border-stone-900/5 bg-white pl-5 pr-3 shadow-[0_12px_40px_rgba(16,20,24,0.14)]"
              : "h-[68px] max-w-[1160px] bg-transparent",
          )}
        >
          <Link to="/" className="inline-flex items-center gap-2 text-xl leading-none" aria-label="DormCheck home">
            <img
              src="/dormcheck-logo-new.png"
              alt=""
              draggable={false}
              className="h-7 w-7 shrink-0 select-none object-contain"
              onError={(e) => {
                e.currentTarget.src = "/dormcheck-logo.png";
              }}
            />
            <span className="brand-wordmark text-[19px]">DormCheck</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Marketing">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-pill px-3.5 py-2 text-[14.5px] font-bold transition-colors",
                    isActive
                      ? "bg-malachite-100 text-malachite-800"
                      : "text-stone-600 hover:bg-malachite-100/60 hover:text-stone-900",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              to={user ? "/my-home" : "/auth"}
              className="hidden whitespace-nowrap rounded-pill bg-malachite-800 px-5 py-2.5 text-[15px] font-extrabold text-white transition-transform hover:-translate-y-px motion-reduce:transition-none sm:inline-flex"
            >
              {user ? "Go to app" : "Get started"}
            </Link>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-pill border border-stone-900/10 bg-white text-stone-900 md:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            aria-label="Marketing"
            // rounded-card: a floating container surface, so it takes the card tier.
            // Was rounded-[22px], an arbitrary radius that was its own third scale.
            className="mx-auto mt-2 max-w-[980px] rounded-card border border-stone-900/5 bg-white p-3 shadow-[0_12px_40px_rgba(16,20,24,0.14)] md:hidden"
          >
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    // rounded-control: a menu row is a control, not a card surface.
                    "block rounded-control px-4 py-3 text-base font-bold",
                    isActive ? "bg-malachite-100 text-malachite-800" : "text-stone-700 hover:bg-malachite-100/60",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
            <Link
              to={user ? "/my-home" : "/auth"}
              className="mt-2 flex items-center justify-center rounded-pill bg-malachite-800 px-5 py-3 text-base font-extrabold text-white sm:hidden"
            >
              {user ? "Go to app" : "Get started"}
            </Link>
          </nav>
        )}
      </header>
      {/* The landing hero carries its own top padding under the transparent
          fixed bar; every other marketing page needs a spacer. */}
      {!isLanding && <div className="h-[84px] bg-tint-50" aria-hidden="true" />}
    </>
  );
}
