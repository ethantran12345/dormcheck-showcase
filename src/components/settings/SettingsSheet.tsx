/**
 * The Settings sheet chrome was promoted to a shared UI primitive so other
 * surfaces (e.g. the checklist template picker) can present as the same
 * near-full-height iOS modal sheet instead of a centered dialog. This file
 * stays as the Settings-named entry point; the implementation lives in
 * `@/components/ui/tall-sheet`.
 */
export { TallSheet as SettingsSheet } from '@/components/ui/tall-sheet';
