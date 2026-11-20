import type { CapacitorConfig } from '@capacitor/cli';

// Live reload (DEV ONLY). When CAP_SERVER_URL is set, the native WKWebView loads
// from your running Vite dev server instead of the bundled `dist/`, so web/UI
// changes hot-reload in the Simulator with no rebuild. Turn it on with the
// `ios:live` script. When unset - i.e. every normal/production build - no `server`
// block is emitted and the app loads `dist/` as usual. NEVER set CAP_SERVER_URL
// for a TestFlight/App Store build.
const liveReloadUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.dormcheck.ios',
  appName: 'DormCheck',
  webDir: 'dist',
  ios: {
    // Disable WKWebView's long-press link preview (Peek & Pop) — long-pressing
    // an in-app <a> (e.g. BottomNav tabs) must not pop the iOS link-preview sheet.
    allowsLinkPreview: false,
  },
  ...(liveReloadUrl ? { server: { url: liveReloadUrl, cleartext: true } } : {}),
  plugins: {
    SocialLogin: {
      google: {
        // Android reads webClientId (shared Web/server OAuth client); iOS reads the iOS* keys.
        webClientId: '216825105344-ilpiadlh40694hno5uptj0cm280vcmsa.apps.googleusercontent.com',
        iOSClientId: '216825105344-8u3shs7jec0oaeo2gu5h6ls14a86i555.apps.googleusercontent.com',
        iOSServerClientId: '216825105344-ilpiadlh40694hno5uptj0cm280vcmsa.apps.googleusercontent.com'
      }
    },
    Keyboard: {
      resize: 'none',
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#03C03C',
      showSpinner: false,
    },
  }
};

export default config;
