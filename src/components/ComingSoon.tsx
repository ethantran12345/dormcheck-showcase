import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DEFAULT_DESCRIPTION =
  "We're rolling DormCheck out in phases. This is on the way. For now, use the Marketplace and Move-In Checklist.";

interface ComingSoonProps {
  title?: string;
  description?: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  const navigate = useNavigate();
  const featureLabel = title ?? 'This feature';

  return (
    // The audit crawl (e2e/lib/audit.ts) classifies a route by finding THIS
    // component. It used to match the words "coming soon" anywhere in the body,
    // which also matched My Home's "Move-in date coming soon" copy; the testid
    // is what makes the gate identifiable without owning that phrase.
    <div
      data-testid="coming-soon"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <Sparkles className="h-12 w-12 shrink-0 text-malachite-600" strokeWidth={1.5} aria-hidden />
      <h1 className="text-2xl font-bold text-foreground">{featureLabel} is coming soon</h1>
      <p className="max-w-sm text-muted-foreground">{description ?? DEFAULT_DESCRIPTION}</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button
          type="button"
          className="bg-malachite-800 font-semibold text-white hover:bg-malachite-900"
          onClick={() => navigate('/marketplace')}
        >
          Browse Marketplace
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate('/checklist')}>
          Move-In Checklist
        </Button>
      </div>
    </div>
  );
}
