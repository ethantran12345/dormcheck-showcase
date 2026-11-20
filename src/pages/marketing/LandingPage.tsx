import LandingPageComponent from '@/components/LandingPage';
import { RouteMeta } from '@/components/seo/RouteMeta';
import { DEFAULT_TITLE } from '@/lib/seo';

export default function LandingPage() {
  return (
    <>
      <RouteMeta title={DEFAULT_TITLE} />
      <LandingPageComponent />
    </>
  );
}
