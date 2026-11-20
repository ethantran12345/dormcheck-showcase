import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  useHomeLocation,
  useHousingHalls,
  useSetHomeLocation,
  type HousingHall,
} from '@/hooks/useSchedule';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hallDiffersFromProfile, syncHomeHallToProfile } from '@/lib/hallSync';
import { autoJoinCommunityRooms } from '@/lib/communityJoin';
import { geocodeAddress, type GeocodeResult } from '@/lib/geocode';
import { useUniversity } from '@/contexts/UniversityContext';

/**
 * Pick where you live: a DormCheck-curated hall (master_housing - residence
 * halls + leased apartments, real coords, no geocoding), or an off-campus
 * street address resolved via geocoding with an explicit confirm step.
 */
export function SetHomeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: home } = useHomeLocation();
  const { data: halls = [], isLoading: hallsLoading } = useHousingHalls();
  const setHome = useSetHomeLocation();
  const { user } = useAuth();
  const { university } = useUniversity();
  const queryClient = useQueryClient();

  const [hall, setHall] = useState<HousingHall | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customAddress, setCustomAddress] = useState('');
  const [pendingMatch, setPendingMatch] = useState<GeocodeResult | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  /** Hall saved to home location that differs from profiles.current_dorm - awaiting the user's call. */
  const [confirmHall, setConfirmHall] = useState<HousingHall | null>(null);
  const [syncingProfile, setSyncingProfile] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHall(halls.find((h) => h.name === home?.label) ?? null);
    setCustomAddress('');
    setPendingMatch(null);
    setConfirmHall(null);
  }, [open, home?.label, halls]);

  const dorms = halls.filter((h) => !h.isApartment);
  const apartments = halls.filter((h) => h.isApartment);

  const saveHall = async () => {
    if (!hall) return;
    try {
      await setHome.mutateAsync({
        building_id: null,
        label: hall.name,
        lat: hall.lat,
        lng: hall.lng,
      });
      toast.success(t('checklist:schedule.homeSetTo', { hall: hall.name }));
      // Offer to mirror the hall into profiles.current_dorm (My Home) so the
      // dorm isn't asked twice. Confirm first: changing the profile dorm also
      // moves the user out of their old building's chats.
      if (user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_dorm, housing_type')
          .eq('id', user.id)
          .maybeSingle();
        if (hallDiffersFromProfile(profile, hall.name)) {
          setConfirmHall(hall);
          return;
        }
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:actions.couldNotSave'));
    }
  };

  const confirmProfileSync = async () => {
    if (!confirmHall || !user?.id) return;
    setSyncingProfile(true);
    try {
      await syncHomeHallToProfile(user.id, confirmHall.name);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-home-profile', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['profile_me', user.id] }),
      ]);
      toast.success(t('checklist:schedule.dormUpdated'));
      // Auto-join the building + floor Community rooms; the toast is the
      // privacy disclosure (display name becomes visible to neighbors).
      void autoJoinCommunityRooms().then((joined) => {
        if (joined) toast.info(t('messaging:community.autoJoinDisclosure'));
      });
      setConfirmHall(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:schedule.couldNotUpdateDorm'));
    } finally {
      setSyncingProfile(false);
    }
  };

  const findAddress = async () => {
    const address = customAddress.trim();
    if (!address) return;
    setGeocoding(true);
    setPendingMatch(null);
    try {
      // Biased to — and distance-guarded against — the student's OWN campus, and
      // the Census fallback disambiguates with their own city. A CMU student
      // typing a street address must not get an Oakland-biased Pitt result.
      const match = await geocodeAddress(address, university.campusCenter, {
        censusCity: university.city,
      });
      if (!match) {
        toast.error(t('checklist:schedule.couldNotFindAddress'));
        return;
      }
      setPendingMatch(match);
    } finally {
      setGeocoding(false);
    }
  };

  const saveMatch = async () => {
    if (!pendingMatch) return;
    try {
      await setHome.mutateAsync({
        building_id: null,
        label: pendingMatch.label,
        lat: pendingMatch.lat,
        lng: pendingMatch.lng,
      });
      toast.success(t('checklist:schedule.homeAddressSaved'));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:actions.couldNotSave'));
    }
  };

  const hallItem = (h: HousingHall) => (
    <CommandItem
      key={h.name}
      value={h.name}
      onSelect={() => {
        setHall(h.name === hall?.name ? null : h);
        setPickerOpen(false);
      }}
    >
      <Check
        className={cn('mr-2 h-4 w-4', hall?.name === h.name ? 'opacity-100' : 'opacity-0')}
      />
      <span className="truncate">{h.name}</span>
    </CommandItem>
  );

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent dialogClassName="sm:max-w-md">
        {confirmHall ? (
          <>
            <ResponsiveModalHeader>
              <ResponsiveModalTitle>{t('checklist:schedule.updateDormTitle')}</ResponsiveModalTitle>
              <ResponsiveModalDescription>
                {t('checklist:schedule.updateDormDescription', { hall: confirmHall.name })}
              </ResponsiveModalDescription>
            </ResponsiveModalHeader>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                onClick={() => void confirmProfileSync()}
                disabled={syncingProfile}
                className="w-full bg-malachite-800 text-white hover:bg-malachite-900"
              >
                {syncingProfile ? t('checklist:schedule.updating') : t('checklist:schedule.yesUpdateDorm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirmHall(null);
                  onOpenChange(false);
                }}
                disabled={syncingProfile}
                className="w-full"
              >
                {t('checklist:schedule.noKeepDorm')}
              </Button>
            </div>
          </>
        ) : (
        <>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('checklist:schedule.whereDoYouLive')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {t('checklist:schedule.whereDoYouLiveDescription')}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="home-hall">{t('checklist:schedule.residenceHallLabel')}</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="home-hall"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  aria-label={t('checklist:schedule.homeHallAria')}
                  className="w-full justify-between font-normal"
                >
                  <span className={cn('truncate', !hall && 'text-muted-foreground')}>
                    {hall ? hall.name : hallsLoading ? t('checklist:schedule.loadingHalls') : t('checklist:schedule.pickYourHall')}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder={t('checklist:schedule.searchHalls')} />
                  <CommandList>
                    <CommandEmpty>{t('checklist:schedule.noHallFound')}</CommandEmpty>
                    <CommandGroup heading={t('checklist:schedule.residenceHallsGroup')}>
                      {dorms.map(hallItem)}
                    </CommandGroup>
                    <CommandGroup heading={t('checklist:schedule.apartmentsGroup')}>
                      {apartments.map(hallItem)}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              onClick={saveHall}
              disabled={!hall || setHome.isPending}
              className="mt-2 w-full bg-malachite-800 text-white hover:bg-malachite-900"
            >
              {t('common:actions.save')}
            </Button>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">
                {t('checklist:schedule.orLiveOffCampus')}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="home-address">{t('checklist:schedule.streetAddress')}</Label>
            <Input
              id="home-address"
              value={customAddress}
              onChange={(e) => {
                setCustomAddress(e.target.value);
                setPendingMatch(null);
              }}
              placeholder="123 Atwood St"
            />
            {pendingMatch ? (
              <div className="mt-2 space-y-2 rounded-xl bg-malachite-50 px-3 py-2.5">
                <p className="flex items-start gap-1.5 text-sm text-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-malachite-700" aria-hidden />
                  {pendingMatch.label}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={saveMatch}
                    disabled={setHome.isPending}
                    className="flex-1 bg-malachite-800 text-white hover:bg-malachite-900"
                  >
                    {t('checklist:schedule.yesSaveThis')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPendingMatch(null)}
                    className="flex-1"
                  >
                    {t('common:actions.tryAgain')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={findAddress}
                disabled={!customAddress.trim() || geocoding}
                className="mt-2 w-full"
              >
                {geocoding ? t('checklist:schedule.findingAddress') : t('checklist:schedule.findAddress')}
              </Button>
            )}
          </div>
        </div>
        </>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
