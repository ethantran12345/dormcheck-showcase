import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { InstagramLogo, SnapchatLogo } from '@/components/roommate/SocialLogos';
import { Phone } from 'lucide-react';

export interface ShowOnListingValues {
  instagram_handle: string;
  snapchat_handle: string;
  phone_number: string;
  show_instagram: boolean;
  show_snapchat: boolean;
  show_phone: boolean;
}

interface ShowOnListingSectionProps {
  values: ShowOnListingValues;
  onChange: (values: ShowOnListingValues) => void;
}

/** Reusable "Show on listing" section: Phone, Instagram, Snapchat rows with icons, inputs, and visibility toggles. */
export function ShowOnListingSection({ values, onChange }: ShowOnListingSectionProps) {
  const { t } = useTranslation();
  const update = (key: keyof ShowOnListingValues, value: string | boolean) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <Label className="text-sm font-semibold text-foreground">{t('marketplace:showOnListing.title')}</Label>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label htmlFor="show-on-listing-phone" className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 shrink-0" />
              {t('marketplace:showOnListing.phoneLabel')}
            </Label>
            <Input
              id="show-on-listing-phone"
              value={values.phone_number}
              onChange={(e) => update('phone_number', e.target.value.trim())}
              placeholder="(412) 555-1234"
              className="rounded-xl border-border"
            />
          </div>
          <Switch
            id="toggle-show-phone"
            checked={values.show_phone}
            onCheckedChange={(checked) => update('show_phone', checked)}
            className="shrink-0 data-[state=checked]:bg-malachite-600"
            aria-label={t('marketplace:showOnListing.togglePhoneAria')}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label htmlFor="show-on-listing-instagram" className="flex items-center gap-2 text-sm">
              <InstagramLogo className="h-4 w-4 shrink-0" />
              Instagram
            </Label>
            <Input
              id="show-on-listing-instagram"
              value={values.instagram_handle}
              onChange={(e) =>
                update('instagram_handle', e.target.value.replace(/^@/, '').trim())
              }
              placeholder="@username"
              className="rounded-xl border-border"
            />
          </div>
          <Switch
            id="toggle-show-instagram"
            checked={values.show_instagram}
            onCheckedChange={(checked) => update('show_instagram', checked)}
            className="shrink-0 data-[state=checked]:bg-malachite-600"
            aria-label={t('marketplace:showOnListing.toggleInstagramAria')}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label htmlFor="show-on-listing-snapchat" className="flex items-center gap-2 text-sm">
              <SnapchatLogo className="h-4 w-4 shrink-0" />
              Snapchat
            </Label>
            <Input
              id="show-on-listing-snapchat"
              value={values.snapchat_handle}
              onChange={(e) =>
                update('snapchat_handle', e.target.value.replace(/^@/, '').trim())
              }
              placeholder={t('marketplace:showOnListing.snapchatPlaceholder')}
              className="rounded-xl border-border"
            />
          </div>
          <Switch
            id="toggle-show-snapchat"
            checked={values.show_snapchat}
            onCheckedChange={(checked) => update('show_snapchat', checked)}
            className="shrink-0 data-[state=checked]:bg-malachite-600"
            aria-label={t('marketplace:showOnListing.toggleSnapchatAria')}
          />
        </div>
      </div>
    </div>
  );
}
