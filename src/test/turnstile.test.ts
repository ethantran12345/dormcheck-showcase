import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import { isCaptchaError, CAPTCHA_ERROR_MESSAGE } from '@/hooks/useTurnstile';
import { getTurnstileSiteKey, isTurnstileConfigured } from '@/lib/turnstile';

// Cloudflare Turnstile captcha wiring. These guard the two correctness-critical
// pure paths: (1) auth handlers must recognize a GoTrue captcha rejection so
// they show friendly copy + auto-reset, and (2) an unconfigured build (no site
// key) must report "not configured" so submit is never blocked before Ethan
// enables Supabase enforcement.

const err = (message: string): AuthError => ({ message, name: 'AuthApiError', status: 400 }) as AuthError;

describe('isCaptchaError', () => {
  it('detects GoTrue captcha rejections (case-insensitive)', () => {
    expect(isCaptchaError(err('captcha protection: request disallowed'))).toBe(true);
    expect(isCaptchaError(err('Captcha verification process failed'))).toBe(true);
  });

  it('ignores unrelated auth errors and nullish input', () => {
    expect(isCaptchaError(err('Invalid login credentials'))).toBe(false);
    expect(isCaptchaError(err('Email not confirmed'))).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });

  it('exposes friendly copy with no em dashes (repo copy rule)', () => {
    expect(CAPTCHA_ERROR_MESSAGE).not.toMatch(/—/);
    expect(CAPTCHA_ERROR_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe('turnstile config gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports unconfigured when the site key is absent (flows not blocked)', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(getTurnstileSiteKey()).toBeUndefined();
    expect(isTurnstileConfigured()).toBe(false);
  });

  it('reports unconfigured for a whitespace-only key', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '   ');
    expect(isTurnstileConfigured()).toBe(false);
  });

  it('reports configured (trimmed) when a real key is present', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '  0x4AAAAAAA_test_key  ');
    expect(getTurnstileSiteKey()).toBe('0x4AAAAAAA_test_key');
    expect(isTurnstileConfigured()).toBe(true);
  });
});
