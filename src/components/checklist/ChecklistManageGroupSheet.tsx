import { useTranslation } from 'react-i18next';
import { Check, Pencil, Users2, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AdaptiveOverlay,
  AdaptiveOverlayClose,
  AdaptiveOverlayContent,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
} from '@/components/ui/adaptive-overlay';
import { PaymentHandlesPopover } from '@/components/checklist/PaymentHandlesPopover';
import { cn } from '@/lib/utils';

export type ChecklistManageGroupMember = {
  id: string;
  user_id: string;
  full_name: string | null;
  email?: string | null;
  avatar_url: string | null;
  venmo_username?: string | null;
  zelle_info?: string | null;
};

export type ChecklistManageGroupSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedGroupId: string;
  selectedGroupDisplayName: string;
  editingGroupName: string | null;
  editGroupNameValue: string;
  onEditGroupNameValueChange: (value: string) => void;
  onStartEditGroupName: () => void;
  onCancelEditGroupName: () => void;
  onSaveGroupName: () => void;
  onInvite: () => void;
  onLeaveGroup: () => void;
  groupMembers: ChecklistManageGroupMember[];
  currentUserId: string | undefined;
  currentUserEmail: string | undefined;
  getInitials: (name: string | null | undefined) => string;
  resolveMemberLabel: (member: {
    full_name?: string | null;
    email?: string | null;
  }) => string;
};

export function ChecklistManageGroupSheet({
  open,
  onOpenChange,
  selectedGroupId,
  selectedGroupDisplayName,
  editingGroupName,
  editGroupNameValue,
  onEditGroupNameValueChange,
  onStartEditGroupName,
  onCancelEditGroupName,
  onSaveGroupName,
  onInvite,
  onLeaveGroup,
  groupMembers,
  currentUserId,
  currentUserEmail,
  getInitials,
  resolveMemberLabel,
}: ChecklistManageGroupSheetProps) {
  const { t } = useTranslation();
  const isEditing = editingGroupName === selectedGroupId;

  return (
    <AdaptiveOverlay open={open} onOpenChange={onOpenChange}>
      <AdaptiveOverlayContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden bg-background p-0 [&>button[aria-label='Close']]:hidden"
        mobileClassName="sm:max-w-md"
        desktopClassName="max-h-[85vh] max-w-md"
      >
        <AdaptiveOverlayHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6 md:pt-4">
          <AdaptiveOverlayTitle className="text-base font-semibold text-foreground sm:text-lg">
            {t("checklist:group.manageGroup")}
          </AdaptiveOverlayTitle>
          <AdaptiveOverlayClose className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </AdaptiveOverlayClose>
        </AdaptiveOverlayHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
          <div className="space-y-6">
            <section className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t("checklist:group.groupName")}</p>
              {isEditing ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSaveGroupName();
                  }}
                >
                  <Input
                    id="edit-group-name-input"
                    value={editGroupNameValue}
                    onChange={(e) => onEditGroupNameValueChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') onCancelEditGroupName();
                    }}
                    placeholder={t("checklist:group.groupNamePlaceholder")}
                    className="h-9 min-w-0 flex-1 border-border focus-visible:ring-malachite-600"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-9 shrink-0 bg-malachite-800 text-white hover:bg-malachite-900"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={onCancelEditGroupName}
                  >
                    {t("common:actions.cancel")}
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {selectedGroupDisplayName}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    className="inline-flex h-auto shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={onStartEditGroupName}
                    aria-label={t("checklist:group.editGroupNameAriaLabel")}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </section>

            <section>
              <Button
                variant="outline"
                size="sm"
                onClick={onInvite}
                className="w-full border-border text-foreground hover:bg-accent"
              >
                <Users2 className="mr-1.5 h-4 w-4" />
                {t("checklist:actions.invite")}
              </Button>
            </section>

            {groupMembers.length > 0 ? (
              <section className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("checklist:group.sharedWith")}</p>
                  <p className="text-xs font-medium text-muted-foreground/80">{t("checklist:group.accepted")}</p>
                </div>
                <div className="space-y-2">
                  {groupMembers.map((member) => {
                    const isMe = member.user_id === currentUserId;
                    const hasPay =
                      !!member.venmo_username?.trim() || !!member.zelle_info?.trim();
                    return (
                      <div
                        key={member.id}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-raised',
                          isMe ? 'border-border font-semibold' : 'border-border',
                        )}
                      >
                        <Avatar className="h-9 w-9 shrink-0 rounded-full border-2 border-border">
                          <AvatarImage src={member.avatar_url ?? undefined} />
                          <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                            {getInitials(member.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'text-sm text-foreground',
                              isMe ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            {resolveMemberLabel({
                              full_name: member.full_name,
                              email: isMe ? (member.email ?? currentUserEmail ?? null) : member.email,
                            })}
                          </span>
                          {isMe && !hasPay ? (
                            <PaymentHandlesPopover
                              venmoUsername={member.venmo_username}
                              zelleInfo={member.zelle_info}
                              groupId={selectedGroupId}
                              align="start"
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                className="inline-flex h-auto w-fit items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                              >
                                {t("checklist:group.addVenmoZelle")}
                              </Button>
                            </PaymentHandlesPopover>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="border-t border-border pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onLeaveGroup();
                }}
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {t("checklist:group.leaveGroup")}
              </Button>
            </section>
          </div>
        </div>
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}
