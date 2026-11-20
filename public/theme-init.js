// FOUC guard. MUST mirror resolveEffectiveTheme() in src/lib/theme.ts
// (this file can't import) — pre-auth routes are always light.
// Loaded as a blocking <script src> in index.html <head> so it runs before
// first paint; extracted from an inline script so the enforcing CSP can use
// script-src 'self' without 'unsafe-inline'.
(function () {
  var p = window.location.pathname;
  var alwaysLight =
    ['/', '/features', '/how-it-works', '/for-students', '/for-universities',
     '/partners', '/feedback', '/about', '/ads', '/moderation',
     '/privacy', '/terms', '/contact', '/waitlist'].indexOf(p) !== -1 ||
    p.indexOf('/auth') === 0 ||
    p.indexOf('/select-school') === 0 ||
    p.indexOf('/onboarding') === 0 ||
    p.indexOf('/admin') === 0;
  var dark = false;
  if (!alwaysLight) {
    var t = localStorage.getItem('dormcheck-theme');
    if (t === 'dark') dark = true;
    else if (t === 'light') dark = false;
    else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (dark) document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0B0F19' : '#ffffff');
})();
