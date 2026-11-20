import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Upload, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { ImageRejectedError, uploadAndScreen } from '@/lib/imageModeration';
import { useAuth } from '@/hooks/useAuth';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type BusinessListing = Tables<'business_listings'>;

const CATEGORIES = [
  'Tutoring',
  'Beauty and Nails',
  'Food and Baking',
  'Creative Services',
  'Tech Help',
  'Photography',
  'Videography',
  'Graphic Design',
  'Music and DJ',
  'Fitness and Personal Training',
  'Hair and Braiding',
  'Makeup and Skincare',
  'Clothing and Alterations',
  'Cleaning Services',
  'Moving Help',
  'Event Planning',
  'Jewelry and Accessories',
  'Art and Illustration',
  'Writing and Editing',
  'Social Media Management',
  'Other',
  'Create your own...',
] as const;

const BANNER_COLORS = [
  '#03C03C',
  '#8B5CF6',
  '#F59E0B',
  '#F43F5E',
  '#6366F1',
  '#64748B',
];

interface PackageRow {
  name: string;
  description: string;
  price: string;
}

interface BusinessListingFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingListing?: BusinessListing | null;
}

export function BusinessListingForm({
  open,
  onOpenChange,
  existingListing,
}: BusinessListingFormProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pickOne } = useImageUpload();
  const queryClient = useQueryClient();
  const isEdit = Boolean(existingListing);

  const existingPackages: PackageRow[] = (() => {
    if (!existingListing?.packages || !Array.isArray(existingListing.packages)) return [];
    return (existingListing.packages as unknown as PackageRow[]).filter(
      (p) => typeof p === 'object' && p !== null && typeof p.name === 'string',
    );
  })();

  const [businessName, setBusinessName] = useState(existingListing?.business_name ?? '');
  const [category, setCategory] = useState(existingListing?.category ?? '');
  const [customCategory, setCustomCategory] = useState('');
  const [description, setDescription] = useState(existingListing?.description ?? '');
  const [priceRange, setPriceRange] = useState(existingListing?.price_range ?? '');
  const [instagramHandle, setInstagramHandle] = useState(existingListing?.instagram_handle ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(existingListing?.website_url ?? '');
  const [bannerColor, setBannerColor] = useState(existingListing?.banner_color ?? '#03C03C');
  const [bannerImageUrl, setBannerImageUrl] = useState(existingListing?.banner_image_url ?? '');
  const [logoUrl, setLogoUrl] = useState(existingListing?.logo_url ?? '');
  const [packages, setPackages] = useState<PackageRow[]>(
    existingPackages.length > 0 ? existingPackages : [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const resolvedCategory = category === 'Create your own...' ? customCategory.trim() : category;

  // Banner and logo are screened before the URL reaches form state, so a refused
  // image is never previewed here and never submitted with the listing. Both
  // catches already blank the URL on failure, which is what keeps this fail-closed
  // when the screen is unavailable.
  const handleBannerUpload = async (file: File) => {
    if (!user) return;
    setUploadingBanner(true);
    try {
      const ext = file.name.split('.').pop();
      setBannerImageUrl(
        await uploadAndScreen({
          bucket: 'business-banners',
          path: `${user.id}/${Date.now()}.${ext}`,
          file,
          context: 'business_image',
          contentId: user.id,
          upload: { upsert: true },
        }),
      );
    } catch (bannerErr: unknown) {
      console.error('BusinessListingForm banner upload error:', bannerErr);
      setBannerImageUrl('');
      toast.error(
        bannerErr instanceof ImageRejectedError
          ? bannerErr.message
          : t('marketplace:business.form.toast.bannerUploadError'),
      );
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!user) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop();
      setLogoUrl(
        await uploadAndScreen({
          bucket: 'business-logos',
          path: `${user.id}/${Date.now()}.${ext}`,
          file,
          context: 'business_image',
          contentId: user.id,
          upload: { upsert: true },
        }),
      );
    } catch (logoErr: unknown) {
      console.error('BusinessListingForm logo upload error:', logoErr);
      setLogoUrl('');
      toast.error(
        logoErr instanceof ImageRejectedError
          ? logoErr.message
          : t('marketplace:business.form.toast.logoUploadError'),
      );
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleBannerPicker = async () => {
    try {
      const file = await pickOne({ source: 'prompt', accept: 'image/*' });
      if (!file) return;
      await handleBannerUpload(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('marketplace:business.form.toast.bannerChooseError'));
    }
  };

  const handleLogoPicker = async () => {
    try {
      const file = await pickOne({ source: 'prompt', accept: 'image/*' });
      if (!file) return;
      await handleLogoUpload(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('marketplace:business.form.toast.logoChooseError'));
    }
  };

  const handlePriceBlur = () => {
    if (priceRange && /^\d/.test(priceRange) && !priceRange.startsWith('$')) {
      setPriceRange(`$${priceRange}`);
    }
  };

  const addPackage = () => {
    if (packages.length >= 6) return;
    setPackages((prev) => [...prev, { name: '', description: '', price: '' }]);
  };

  const removePackage = (idx: number) => {
    setPackages((prev) => prev.filter((_, i) => i !== idx));
  };

  const updatePackage = (idx: number, field: keyof PackageRow, value: string) => {
    setPackages((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)),
    );
  };

  const handleSubmit = async () => {
    if (!user) return;
    const nameTrimmed = businessName.trim();
    const categoryTrimmed = resolvedCategory.trim();
    const descriptionTrimmed = description.trim();
    if (!nameTrimmed) { toast.error(t('marketplace:business.form.toast.nameRequired')); return; }
    if (!categoryTrimmed) { toast.error(t('marketplace:business.form.toast.categoryRequired')); return; }
    if (!descriptionTrimmed) { toast.error(t('marketplace:business.form.toast.descriptionRequired')); return; }

    setSubmitting(true);
    try {
      const filteredPackages = packages.filter((p) => p.name.trim());
      const packagesJson =
        filteredPackages.length > 0
          ? filteredPackages.map((p) => ({
              name: p.name.trim(),
              description: p.description.trim(),
              price: p.price.trim(),
            }))
          : null;

      const payload = {
        business_name: nameTrimmed,
        category: categoryTrimmed,
        description: descriptionTrimmed,
        price_range: priceRange.trim() || null,
        instagram_handle: instagramHandle.trim().replace(/^@/, '') || null,
        website_url: websiteUrl.trim() || null,
        banner_color: bannerImageUrl ? null : bannerColor,
        banner_image_url: bannerImageUrl.trim() || null,
        logo_url: logoUrl.trim() || null,
        packages: packagesJson,
      };

      if (isEdit && existingListing) {
        const { error } = await supabase
          .from('business_listings')
          .update(payload)
          .eq('id', existingListing.id);
        if (error) throw error;
        toast.success(t('marketplace:business.form.toast.updated'));
        await queryClient.invalidateQueries({ queryKey: ['business_listings'] });
        await queryClient.invalidateQueries({ queryKey: ['my_business_listings'] });
        onOpenChange(false);
      } else {
        const { error } = await supabase.from('business_listings').insert({
          ...payload,
          user_id: user.id,
          is_approved: false,
          is_active: true,
        });
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: ['business_listings'] });
        await queryClient.invalidateQueries({ queryKey: ['my_business_listings'] });
        setShowSuccess(true);
      }
    } catch (error: unknown) {
      console.error('BusinessListingForm submit error:', error);
      const errObj = error as { message?: string };
      toast.error(
        errObj?.message ??
          (error !== undefined && error !== null ? JSON.stringify(error) : 'Unknown error'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setShowSuccess(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-full h-full max-w-none m-0 rounded-none translate-x-0 translate-y-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-[550px] sm:w-[95%] sm:max-h-[90vh] sm:h-[90vh] sm:rounded-lg flex flex-col overflow-hidden p-0 gap-0 [&>:last-child]:top-[max(0.75rem,env(safe-area-inset-top))] [&>:last-child]:right-[max(0.75rem,env(safe-area-inset-right))] sm:[&>:last-child]:top-4 sm:[&>:last-child]:right-4">
        <DialogHeader className="shrink-0 px-4 pr-14 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:pr-6 sm:pt-6">
          <DialogTitle>{isEdit ? t('marketplace:business.form.editTitle') : t('marketplace:business.form.createTitle')}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('marketplace:business.form.editDescription')
              : t('marketplace:business.form.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {showSuccess ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
              <div className="h-16 w-16 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-muted-foreground" strokeWidth={1.75} />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('marketplace:business.form.success.title')}</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {t('marketplace:business.form.success.subtitle')}
              </p>
              {/* Dismiss, not a primary action — the dialog's one earned CTA is Submit. */}
              <Button onClick={handleClose} variant="outline" className="mt-2">
                {t('common:actions.done')}
              </Button>
            </div>
          ) : (
            <div className="space-y-5 px-4 sm:px-6 pb-4">
              {/* Business Name */}
              <div>
                <Label>{t('marketplace:business.form.fields.name')} <span className="text-destructive">*</span></Label>
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder={t('marketplace:business.form.fields.namePlaceholder')}
                  className="mt-1 focus-visible:ring-malachite-600"
                />
              </div>

              {/* Category */}
              <div>
                <Label>{t('marketplace:business.form.fields.category')} <span className="text-destructive">*</span></Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1 focus-visible:ring-malachite-600">
                    <SelectValue placeholder={t('marketplace:business.form.fields.categoryPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {category === 'Create your own...' && (
                  <Input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder={t('marketplace:business.form.fields.customCategoryPlaceholder')}
                    className="mt-2 focus-visible:ring-malachite-600"
                  />
                )}
              </div>

              {/* Description */}
              <div>
                <Label>{t('marketplace:business.form.fields.description')} <span className="text-destructive">*</span></Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('marketplace:business.form.fields.descriptionPlaceholder')}
                  rows={4}
                  className="mt-1 focus-visible:ring-malachite-600"
                />
              </div>

              {/* Price Range */}
              <div>
                <Label>{t('marketplace:business.form.fields.priceRange')}</Label>
                <Input
                  value={priceRange}
                  onChange={(e) => setPriceRange(e.target.value)}
                  onBlur={handlePriceBlur}
                  placeholder={t('marketplace:business.form.fields.priceRangePlaceholder')}
                  className="mt-1 focus-visible:ring-malachite-600"
                />
              </div>

              {/* Instagram */}
              <div>
                <Label>{t('marketplace:business.form.fields.instagram')}</Label>
                <Input
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder={t('marketplace:business.form.fields.instagramPlaceholder')}
                  className="mt-1 focus-visible:ring-malachite-600"
                />
              </div>

              {/* Website */}
              <div>
                <Label>{t('marketplace:business.form.fields.website')}</Label>
                <Input
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder={t('marketplace:business.form.fields.websitePlaceholder')}
                  className="mt-1 focus-visible:ring-malachite-600"
                />
              </div>

              {/* Banner Color */}
              <div>
                <Label>{t('marketplace:business.form.fields.bannerColor')}</Label>
                <div className="flex gap-2 mt-2">
                  {BANNER_COLORS.map((color) => (
                    <Button
                      key={color}
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => { setBannerColor(color); setBannerImageUrl(''); }}
                      aria-pressed={bannerColor === color && !bannerImageUrl}
                      className={cn(
                        'h-8 w-8 rounded-full border-2 transition-all',
                        bannerColor === color && !bannerImageUrl
                          ? 'scale-110 border-foreground'
                          : 'border-transparent hover:scale-105',
                      )}
                      style={{ backgroundColor: color }}
                      aria-label={t('marketplace:business.form.selectColorAria', { color })}
                    />
                  ))}
                </div>
              </div>

              {/* Banner Image */}
              <div>
                <Label>{t('marketplace:business.form.fields.bannerImage')}</Label>
                <div className="mt-2 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleBannerPicker()}
                    disabled={uploadingBanner}
                  >
                    {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {bannerImageUrl ? t('marketplace:business.form.change') : t('marketplace:business.form.upload')}
                  </Button>
                  {bannerImageUrl && (
                    <>
                      <img src={bannerImageUrl} alt="" className="h-8 w-16 rounded object-cover" />
                      <Button type="button" variant="ghost" onClick={() => setBannerImageUrl('')} className="h-auto rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">{t('common:actions.remove')}</Button>
                    </>
                  )}
                </div>
              </div>

              {/* Logo */}
              <div>
                <Label>{t('marketplace:business.form.fields.logo')}</Label>
                <div className="mt-2 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleLogoPicker()}
                    disabled={uploadingLogo}
                  >
                    {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {logoUrl ? t('marketplace:business.form.change') : t('marketplace:business.form.upload')}
                  </Button>
                  {logoUrl && (
                    <>
                      <img src={logoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                      <Button type="button" variant="ghost" onClick={() => setLogoUrl('')} className="h-auto rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">{t('common:actions.remove')}</Button>
                    </>
                  )}
                </div>
              </div>

              {/* Packages */}
              <div>
                <Label>{t('marketplace:business.detail.packagesTitle')}</Label>
                <div className="mt-2 space-y-3">
                  {packages.map((pkg, idx) => (
                    <div key={idx} className="rounded-lg border border-border bg-muted p-3 space-y-2 relative">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePackage(idx)}
                        className="absolute right-2 top-2 h-6 w-6 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
                        aria-label={t('marketplace:business.form.removePackageAria')}
                      >
                        <X />
                      </Button>
                      <Input
                        value={pkg.name}
                        onChange={(e) => updatePackage(idx, 'name', e.target.value)}
                        placeholder={t('marketplace:business.form.packageNamePlaceholder')}
                        className="focus-visible:ring-malachite-600"
                      />
                      <Textarea
                        value={pkg.description}
                        onChange={(e) => {
                          if (e.target.value.length <= 100) updatePackage(idx, 'description', e.target.value);
                        }}
                        placeholder={t('marketplace:business.form.packageDescPlaceholder')}
                        rows={2}
                        className="focus-visible:ring-malachite-600"
                      />
                      <p className="text-[10px] text-muted-foreground text-right">{pkg.description.length}/100</p>
                      <Input
                        value={pkg.price}
                        onChange={(e) => updatePackage(idx, 'price', e.target.value)}
                        placeholder={t('marketplace:business.form.packagePricePlaceholder')}
                        className="focus-visible:ring-malachite-600"
                      />
                    </div>
                  ))}
                  {packages.length < 6 && (
                    <Button type="button" variant="outline" size="sm" className="gap-1.5 w-full" onClick={addPackage}>
                      <Plus className="h-4 w-4" />
                      {t('marketplace:business.form.addPackage')}
                    </Button>
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
        {!showSuccess && (
          <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <Button
              // KEEP: primary CTA of the form (submit listing)
              className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {isEdit ? t('common:actions.saveChanges') : t('marketplace:business.form.submitReview')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
