import { useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/utils";

interface SneakPeekBlurWallProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
  className?: string;
  /** Optional max height for the container (e.g. "750px", "1150px"). Defaults to 750px. */
  revealHeight?: string;
  /** Optional heading above the CTA button. */
  title?: string;
  /** Optional subtext below the title, above the button. */
  description?: string;
}

/**
 * When user is not authenticated: shows content in a fixed-height container (~1.5 rows of cards),
 * with a frosted-glass overlay at the bottom. Cards flow normally and are visible (blurred) behind the overlay.
 * When authenticated, renders children only.
 */
export function SneakPeekBlurWall({
  children,
  isAuthenticated,
  className,
  revealHeight = "750px",
  title,
  description,
}: SneakPeekBlurWallProps) {
  const navigate = useNavigate();
  const location = useLocation();

  if (isAuthenticated) {
    return <div className={className}>{children}</div>;
  }

  const hasTitleOrDescription = title != null || description != null;

  return (
    <div
      className={cn("relative w-full overflow-hidden pb-[200px]", className)}
      style={{ maxHeight: revealHeight }}
    >
      {/* Cards flow normally; no bottom padding - they extend under the overlay */}
      {children}

      {/* Frosted glass overlay: glass layer blurs background; text layer stays crisp */}
      <div
        className="absolute bottom-0 left-0 w-full h-[200px] z-10 flex flex-col items-center justify-end pb-12"
        role="presentation"
      >
        {/* Glass layer: blur and mask only - no text */}
        <div className="absolute inset-0 bg-background/70 backdrop-blur-lg [mask-image:linear-gradient(to_bottom,transparent,black_20%)] -z-10 pointer-events-none" />
        {/* Text layer: no blur or mask - stays sharp */}
        <div className="relative z-10 flex flex-col items-center text-center px-4">
          {hasTitleOrDescription ? (
            <>
              {title != null && (
                <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-1">
                  {title}
                </h3>
              )}
              {description != null && (
                <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
                  {description}
                </p>
              )}
            </>
          ) : (
            <p className="text-base font-medium text-foreground">
              Sign in to see more listings and join the community.
            </p>
          )}
          <button
            type="button"
            onClick={() => navigate(`/auth?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`)}
            className="mt-2 rounded-full bg-malachite-800 px-6 py-3 text-sm font-bold text-white shadow-raised transition-colors hover:bg-malachite-900"
          >
            Sign In / Create Profile
          </button>
        </div>
      </div>
    </div>
  );
}
