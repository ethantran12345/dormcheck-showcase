import { useLocation } from "react-router";
import { canonicalUrl } from "@/lib/seo";

/**
 * Declares a public route's `<title>` and self-referencing `<link rel="canonical">`.
 *
 * Render it at the top of a PUBLIC page component. React 19 hoists both tags
 * into `<head>` on its own — no portal, no dependency, no effect. Rationale,
 * measured hoisting behaviour and the deliberate `og:*` omission: `@/lib/seo`.
 *
 * The canonical defaults to the live pathname (self-referencing, query stripped).
 * Pass `canonicalPath` only when a route must point somewhere else.
 *
 * Do NOT add this to auth-gated routes — they are not indexable.
 */
export function RouteMeta({
  title,
  canonicalPath,
}: {
  title: string;
  canonicalPath?: string;
}) {
  const { pathname } = useLocation();
  return (
    <>
      <title>{title}</title>
      <link rel="canonical" href={canonicalUrl(canonicalPath ?? pathname)} />
    </>
  );
}
