import { Link } from "react-router";
import { Facebook, Instagram, Linkedin, Music2, Twitter } from "lucide-react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

const hoverClass = "text-muted-foreground hover:text-malachite-600 transition-colors";

interface FooterProps {
  onOpenSupportModal?: () => void;
}

const Footer = ({ onOpenSupportModal }: FooterProps) => {
  const { showHousing, showRoommates } = useFeatureFlags();

  return (
    <footer className="hidden md:block bg-background text-foreground pt-16 pb-8 px-6 border-t border-border">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
        {/* Column 1 - DormCheck Branding */}
        <div className="flex flex-col gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-lg leading-none"
          >
            <img
              src="/dormcheck-logo-new.png"
              alt=""
              draggable={false}
              className="h-[1em] w-[1em] shrink-0 object-contain select-none"
              onError={(e) => { e.currentTarget.src = "/dormcheck-logo.png"; }}
            />
            <img
              src="/dormcheck-logo-new.png"
              alt=""
              draggable={false}
              className="hidden h-[1em] w-[1em] shrink-0 object-contain select-none"
              onError={(e) => { e.currentTarget.src = "/dormcheck-logo-dark.png"; }}
            />
            <span className="brand-wordmark">DormCheck</span>
          </Link>
          <p className="text-sm text-muted-foreground ">The Visual Layer of Student Living</p>
          <div className="flex gap-4 pt-2">
            <a
              href="https://www.instagram.com/dormcheck_app"
              target="_blank"
              rel="noopener noreferrer"
              className={hoverClass}
              aria-label="Instagram @dormcheck_app"
            >
              <Instagram size={20} />
            </a>
            <a
              href="https://www.tiktok.com/@dormcheck"
              target="_blank"
              rel="noopener noreferrer"
              className={hoverClass}
              aria-label="TikTok @dormcheck"
            >
              <Music2 size={20} />
            </a>
            <a
              href="https://www.linkedin.com/company/dormcheck"
              target="_blank"
              rel="noopener noreferrer"
              className={hoverClass}
              aria-label="LinkedIn @dormcheck"
            >
              <Linkedin size={20} />
            </a>
            <a
              href="https://x.com/dormcheck"
              target="_blank"
              rel="noopener noreferrer"
              className={hoverClass}
              aria-label="X (Twitter) @dormcheck"
            >
              <Twitter size={20} />
            </a>
            <a
              href="https://www.facebook.com/people/Dormcheck/61588622997141/"
              target="_blank"
              rel="noopener noreferrer"
              className={hoverClass}
              aria-label="Facebook @Dormcheck"
            >
              <Facebook size={20} />
            </a>
          </div>
        </div>

        {/* Column 2 - Key Resources (matches Top Nav) */}
        <div>
          <h3 className="font-bold mb-4">Key Resources</h3>
          <ul className="space-y-2 text-muted-foreground text-sm">
            {showHousing && (
              <li>
                <Link to="/campus" className={hoverClass}>
                  Housing
                </Link>
              </li>
            )}
            {showRoommates && (
              <li>
                <Link to="/roommates" className={hoverClass}>
                  Roommates
                </Link>
              </li>
            )}
            <li>
              <Link to="/marketplace" className={hoverClass}>
                Marketplace
              </Link>
            </li>
            <li>
              <Link to="/checklist" className={hoverClass}>
                Checklist
              </Link>
            </li>
          </ul>
        </div>

        {/* Column 3 - Resources */}
        <div>
          <h3 className="font-bold mb-4">Resources</h3>
          <ul className="space-y-2 text-muted-foreground text-sm">
            <li>
              <a
                href="https://www.pc.pitt.edu/"
                target="_blank"
                rel="noopener noreferrer"
                className={hoverClass}
              >
                Panther Central
              </a>
            </li>
            <li>
              <Link to="/ads" className={hoverClass}>
                Local Business Portal
              </Link>
            </li>
            <li>
              <a
                href="https://rateyinzlandlord.com/"
                target="_blank"
                rel="noopener noreferrer"
                className={hoverClass}
                title="Review your Oakland landlord"
              >
                RateYinzLandlord
              </a>
            </li>
          </ul>
        </div>

        {/* Column 4 - Legal & Support */}
        <div>
          <h3 className="font-bold mb-4">Legal & Support</h3>
          <ul className="space-y-2 text-muted-foreground text-sm">
            <li>
              <Link to="/privacy" className={hoverClass}>
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link to="/terms" className={hoverClass}>
                Terms of Service
              </Link>
            </li>
            <li>
              <Link to="/moderation" className={hoverClass}>
                Moderation Guidelines
              </Link>
            </li>
            <li>
              <Link to="/delete-account" className={hoverClass}>
                Delete Account
              </Link>
            </li>
            <li>
              {onOpenSupportModal ? (
                <button
                  type="button"
                  onClick={onOpenSupportModal}
                  className={`text-left text-sm bg-transparent border-none p-0 cursor-pointer font-inherit ${hoverClass}`}
                >
                  Support
                </button>
              ) : (
                <a href="mailto:support@dormcheck.com" className={hoverClass}>
                  Support
                </a>
              )}
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-16 pt-8 border-t border-border text-center text-muted-foreground text-xs max-w-7xl mx-auto">
        <p>© 2026 Dormcheck LLC. | Built at the University of Pittsburgh | Not an official University of Pittsburgh website.</p>
      </div>
    </footer>
  );
};

export default Footer;
