import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useReportChatLink } from '@/hooks/useBuildingChatLinks';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface ReportLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkId: string | null;
  linkLabel: string;
}

export function ReportLinkDialog({ open, onOpenChange, linkId, linkLabel }: ReportLinkDialogProps) {
  const { t } = useTranslation();
  const reportMutation = useReportChatLink();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  const handleReport = async () => {
    if (!linkId) return;
    try {
      await reportMutation.mutateAsync({ linkId, reason: reason.trim() || undefined });
      toast(t('housing:portal.report.reported'), {
        description: t('housing:portal.report.reportedDescription'),
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(t('housing:portal.report.reportError'), {
        description: (e as Error).message,
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('housing:portal.report.reportThisLink')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('housing:portal.report.reportDescription', { label: linkLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <label htmlFor="report-reason" className="block text-sm font-medium text-foreground mb-1.5">
            {t('housing:portal.report.reasonLabel')} <span className="text-muted-foreground font-normal">{t('common:state.optional')}</span>
          </label>
          <Input
            id="report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('housing:portal.report.reasonPlaceholder')}
            maxLength={500}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={reportMutation.isPending}>{t('common:actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleReport}
            disabled={reportMutation.isPending}
            className="bg-red-600 hover:bg-red-700"
          >
            {reportMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('housing:portal.report.reporting')}</>
            ) : (
              t('housing:portal.report.reportButton')
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
