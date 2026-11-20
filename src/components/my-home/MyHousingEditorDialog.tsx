import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useHousingHalls } from '@/hooks/useHousingHalls';
import { findHallByName, syncHallToHomeLocation } from '@/lib/hallSync';
import { autoJoinCommunityRooms } from '@/lib/communityJoin';
import { sanitizeText } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface HousingProfileSnapshot {
  housing_type: string | null;
  current_dorm: string | null;
  current_floor: string | null;
  current_room: string | null;
  neighborhood: string | null;
}

interface MyHousingEditorDialogProps {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: HousingProfileSnapshot;
}

export function MyHousingEditorDialog({
  userId,
  open,
  onOpenChange,
  profile,
}: MyHousingEditorDialogProps) {
  const queryClient = useQueryClient();
  const [editHousingType, setEditHousingType] = useState<'on-campus' | 'off-campus' | null>(null);
  const [editDorm, setEditDorm] = useState('');
  const [editFloor, setEditFloor] = useState('');
  const [editRoom, setEditRoom] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNeighborhood, setEditNeighborhood] = useState('');
  const [savingHousing, setSavingHousing] = useState(false);
  const {
    data: housingHalls,
    isLoading: isDormOptionsLoading,
    isError: dormOptionsFailed,
  } = useHousingHalls();
  const dormOptions = (housingHalls ?? []).map((h) => h.name);
  const dormOptionsError = dormOptionsFailed ? 'Failed to load dorms' : null;

  const currentDormDisplay = (profile.current_dorm ?? '').trim();
  const displayHousingType =
    profile.housing_type === 'off-campus'
      ? 'off-campus'
      : profile.housing_type === 'on-campus'
        ? 'on-campus'
        : null;

  const seedFormFromProfile = useCallback(() => {
    const ht = profile.housing_type;
    if (ht === 'off-campus') {
      setEditHousingType('off-campus');
      setEditAddress((profile.current_dorm ?? '').trim());
      setEditNeighborhood((profile.neighborhood ?? '').trim());
      setEditDorm('');
      setEditFloor('');
      setEditRoom('');
    } else if (ht === 'on-campus') {
      setEditHousingType('on-campus');
      setEditDorm((profile.current_dorm ?? '').trim());
      setEditFloor((profile.current_floor ?? '').trim());
      setEditRoom((profile.current_room ?? '').trim());
      setEditAddress('');
      setEditNeighborhood('');
    } else {
      // On-campus is the only option for now, so default to it (form shows immediately).
      setEditHousingType('on-campus');
      setEditDorm('');
      setEditFloor('');
      setEditRoom('');
      setEditAddress('');
      setEditNeighborhood('');
    }
  }, [profile]);

  useEffect(() => {
    if (open) seedFormFromProfile();
  }, [open, seedFormFromProfile]);

  const invalidateHousingQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-home-profile', userId] }),
      queryClient.invalidateQueries({ queryKey: ['profile_me', userId] }),
    ]);
  }, [queryClient, userId]);

  const handleSaveHousing = async () => {
    if (!editHousingType) {
      toast.error('Choose where you live', { description: 'Select on-campus or off-campus.' });
      return;
    }
    setSavingHousing(true);
    try {
      if (editHousingType === 'on-campus') {
        const d = editDorm.trim();
        if (!d) {
          toast.error('Select a building');
          setSavingHousing(false);
          return;
        }
        const floorTrimmed = sanitizeText(editFloor.trim());
        const roomTrimmed = sanitizeText(editRoom.trim());
        const { error } = await supabase
          .from('profiles')
          .update({
            housing_type: 'on-campus',
            current_dorm: d,
            current_floor: floorTrimmed || null,
            current_room: roomTrimmed || null,
            neighborhood: null,
          })
          .eq('id', userId);
        if (error) throw error;
        // Halls only: mirror into the schedule's home location so walking
        // routes work without a second ask. Best-effort - never blocks save.
        const hall = findHallByName(housingHalls, d);
        if (hall) {
          try {
            await syncHallToHomeLocation(userId, hall);
            void queryClient.invalidateQueries({ queryKey: ['home-location'] });
          } catch (syncErr) {
            console.error('Home location sync failed (non-blocking):', syncErr);
          }
        }
        // Auto-join the building + floor Community rooms; the toast is the
        // privacy disclosure (display name becomes visible to neighbors).
        void autoJoinCommunityRooms().then((joined) => {
          if (joined) {
            toast.info("You're joining your building and floor rooms in Community. Your display name is visible to neighbors there.");
            void queryClient.invalidateQueries({ queryKey: ['building-chats'] });
            void queryClient.invalidateQueries({ queryKey: ['group-conversations'] });
          }
        });
      } else {
        const addr = sanitizeText(editAddress.trim());
        const neigh = editNeighborhood.trim();
        if (!addr || !neigh) {
          toast.error('Missing info', { description: 'Enter address and neighborhood.' });
          setSavingHousing(false);
          return;
        }
        const { error } = await supabase
          .from('profiles')
          .update({
            housing_type: 'off-campus',
            current_dorm: addr,
            current_floor: null,
            current_room: null,
            neighborhood: neigh,
          })
          .eq('id', userId);
        if (error) throw error;
      }
      await invalidateHousingQueries();
      toast.success('Housing saved');
      onOpenChange(false);
    } catch {
      toast.error('Could not save housing', { description: 'Please try again.' });
    } finally {
      setSavingHousing(false);
    }
  };

  const handleClearHousing = async () => {
    setSavingHousing(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          housing_type: null,
          current_dorm: null,
          current_floor: null,
          current_room: null,
          neighborhood: null,
        })
        .eq('id', userId);
      if (error) throw error;
      await invalidateHousingQueries();
      toast.success('Housing cleared');
      onOpenChange(false);
    } catch {
      toast.error('Could not clear housing', { description: 'Please try again.' });
    } finally {
      setSavingHousing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Flex column: header + footer are fixed; only the middle form scrolls, so the
          // Save/Cancel buttons stay visible above the keyboard instead of scrolling under it.
          "flex flex-col gap-0 p-0",
          // Mobile: bottom sheet. Bottom rides up with the keyboard (--keyboard-height,
          // set in App.tsx) and max-height shrinks to match.
          "!fixed !inset-x-0 !bottom-[var(--keyboard-height,0px)] !top-auto !z-[10062] !m-0 !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-2xl !rounded-b-none max-h-[calc(92dvh-var(--keyboard-height,0px))] transition-[bottom] duration-200 ease-out",
          // Desktop: centered modal.
          "sm:!inset-auto sm:!left-1/2 sm:!top-1/2 sm:!bottom-auto sm:!w-full sm:!max-w-md sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!max-h-[90vh] sm:!rounded-2xl",
        )}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader className="shrink-0 px-5 pt-5">
          <DialogTitle>Update housing</DialogTitle>
          <DialogDescription>
            Where you live helps match you with the right community and listings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2">
          <div className="space-y-3">
            <div>
              <Label htmlFor="housing-edit-dorm">
                Building <span className="text-red-500 ml-0.5">*</span>
              </Label>
              {isDormOptionsLoading && dormOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1.5">Loading buildings…</p>
              ) : dormOptionsError ? (
                <p className="text-sm text-destructive mt-1.5">{dormOptionsError}</p>
              ) : (
                <Select value={editDorm || undefined} onValueChange={setEditDorm}>
                  <SelectTrigger id="housing-edit-dorm" className="mt-1.5">
                    <SelectValue placeholder="Select your building..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 bg-popover border-border">
                    {dormOptions.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="housing-edit-floor">Floor (optional)</Label>
                <Input
                  id="housing-edit-floor"
                  value={editFloor}
                  onChange={(e) => setEditFloor(sanitizeText(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="e.g. 3"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="housing-edit-room">Room (optional)</Label>
                <Input
                  id="housing-edit-room"
                  value={editRoom}
                  onChange={(e) => setEditRoom(sanitizeText(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="e.g. 412"
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex-col-reverse sm:flex-row sm:justify-between sm:items-center sm:pb-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleClearHousing()}
            disabled={savingHousing || (!currentDormDisplay && !displayHousingType)}
            className="text-red-500 hover:text-red-600 hover:bg-red-50 mr-auto w-full sm:w-auto"
          >
            Clear housing
          </Button>
          <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={savingHousing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-malachite-800 hover:bg-malachite-900 text-white"
              onClick={() => void handleSaveHousing()}
              disabled={savingHousing || !editHousingType}
            >
              {savingHousing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
