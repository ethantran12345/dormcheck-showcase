import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { SocialLogin } from "@capgo/capacitor-social-login";
import App from "./App.tsx";
import { e2eAutoLogin } from "./lib/e2eAutoLogin";
import { installChunkRecovery } from "./lib/chunkRecovery";
import "./index.css";
import "./i18n";

// Dev/e2e only; no-op unless VITE_E2E_AUTOLOGIN=1 against a local Supabase.
void e2eAutoLogin();

// A deploy or live-reload rebuild can replace hashed lazy chunks while an open
// tab/WKWebView still holds the old module graph. Vite emits this event before
// React sees the rejected import; one guarded reload obtains the current graph.
installChunkRecovery();

// Platform root class: single lever for platform-scoped styling (e.g. the web
// canvas is white while native keeps the malachite-tinted --background).
document.documentElement.classList.add(
  Capacitor.isNativePlatform() ? "platform-native" : "platform-web",
);

if (Capacitor.isNativePlatform()) {
  // Native app should feel native: WKWebView enforces the viewport, so lock scale
  // to disable pinch + double-tap zoom. Native-only - web/mobile-Safari ignores
  // these anyway and must keep pinch-zoom for WCAG 1.4.4.
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    );

  // Google sign-in on both native shells: iOS reads the iOS* keys; Android uses
  // webClientId (the shared Web/server OAuth client — the Android OAuth clients
  // in Google Cloud only authorize the package+SHA-1, they're never referenced
  // in code).
  SocialLogin.initialize({
    google: {
      webClientId: '216825105344-ilpiadlh40694hno5uptj0cm280vcmsa.apps.googleusercontent.com',
      iOSClientId: '216825105344-8u3shs7jec0oaeo2gu5h6ls14a86i555.apps.googleusercontent.com',
      iOSServerClientId: '216825105344-ilpiadlh40694hno5uptj0cm280vcmsa.apps.googleusercontent.com',
      mode: 'online'
    }
  }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  import('@capacitor/splash-screen').then(({ SplashScreen }) => {
    setTimeout(() => { SplashScreen.hide().catch(() => {}); }, 4000);
  });
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
