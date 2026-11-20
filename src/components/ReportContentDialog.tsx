import { useState, useEffect, type MouseEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useReportContent,
  REPORT_CATEGORY_LABELS,
  type ReportableContentType,
  type ReportCategory,
} from '@/hooks/useContentReports';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface ReportContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: ReportableContentType | null;
  contentId: string | null;
  /** Human-readable label for what's being reported (e.g. "this review",
   *  "this listing"). Shown in dialog description. */
  contentLabel: string;
}

export function ReportContentDialog({
  open,
  onOpenChange,
  contentType,
  contentId,
  contentLabel,
}: ReportContentDialogProps) {
  const reportMutation = useReportContent();
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) {
      setCategory('');
      setReason('');
    }
  }, [open]);

  const handleReport = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault(); // prevent Radix from closing before mutation completes
    if (!contentType || !contentId || !category) return;
    try {
      await reportMutation.mutateAsync({
        contentType,
        contentId,
        category,
        reason: reason.trim() || undefined,
      });
      toast('Reported', {
        description: "Thanks. We'll review this.",
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not submit report', {
        description: (err as Error).message,
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Report {contentLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            Report {contentLabel} if it&apos;s spam, inappropriate, or violates community guidelines. An admin will
            review.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <label
            htmlFor="report-content-category"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            What&apos;s wrong?
          </label>
          <Select value={category} onValueChange={(v) => setCategory(v as ReportCategory)}>
            <SelectTrigger id="report-content-category" aria-label="Report category">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(REPORT_CATEGORY_LABELS) as ReportCategory[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {REPORT_CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="pb-2">
          <label htmlFor="report-content-reason" className="block text-sm font-medium text-foreground mb-1.5">
            Details <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            id="report-content-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Anything else we should know?"
            maxLength={500}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={reportMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleReport}
            disabled={reportMutation.isPending || !contentType || !contentId || !category}
            className="bg-red-600 hover:bg-red-700"
          >
            {reportMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Reporting…
              </>
            ) : (
              'Submit report'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
