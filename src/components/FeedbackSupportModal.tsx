import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { sanitizeText } from "@/lib/sanitize";
import { apiPost } from "@/lib/apiPost";
import { toast } from "sonner";
import {
  PROFILE_DIALOG_BODY_CLASS,
  PROFILE_DIALOG_CONTENT_CLASS,
  PROFILE_DIALOG_FOOTER_CLASS,
  PROFILE_DIALOG_HEADER_CLASS,
} from "@/lib/profileDialogClasses";

interface FeedbackSupportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SUPPORT_EMAIL = "support@dormcheck.com";

export function FeedbackSupportModal({ open, onOpenChange }: FeedbackSupportModalProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const sanitized = sanitizeText(feedbackText);
    if (!sanitized) return;

    setIsSubmitting(true);

    try {
      const res = await apiPost("/api/feedback", { message: sanitized });

      if (res.ok) {
        setFeedbackText("");
        onOpenChange(false);
        toast.success("Feedback sent", {
          description: "Thanks - we got your message and will take a look.",
        });
        return;
      }
      throw new Error(`Feedback request failed (${res.status})`);
    } catch {
      // Surface the failure and keep the text so the user can retry, instead of
      // silently swallowing it into a mailto: that does nothing on native.
      toast.error("Couldn't send feedback", {
        description: `Something went wrong. Please try again, or email ${SUPPORT_EMAIL}.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFeedbackText("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={PROFILE_DIALOG_HEADER_CLASS}>
          <DialogTitle>Feedback & Support</DialogTitle>
          <DialogDescription>
            Have a question or suggestion? Send us a message.
          </DialogDescription>
        </DialogHeader>
        {/* Shared scrollable body (Cancel/Submit stay bottom-anchored). The
            textarea is a fixed area near the top - no flex-1, so it doesn't grow
            to fill the sheet. Keyboard space is reserved once by the CONTENT
            shell; the shared body no longer double-counts it (would clip the
            footer behind the keyboard). */}
        <div className={PROFILE_DIALOG_BODY_CLASS}>
          <Textarea
            placeholder="Share your feedback, suggestions, or report issues..."
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            className="min-h-[140px] max-h-[45vh] resize-none border-malachite-600/50 focus-visible:ring-malachite-600"
          />
        </div>
        <DialogFooter className={PROFILE_DIALOG_FOOTER_CLASS}>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!feedbackText.trim() || isSubmitting}
            className="bg-malachite-800 hover:bg-malachite-900 text-white"
          >
            {isSubmitting ? "Sending..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
