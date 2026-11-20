import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Client env vars that MUST be present for a production bundle to work.
// A missing/empty one of these throws on load in src/integrations/supabase/client.ts,
// which renders a fully blank page. Keep this list as the single source of truth - 
// add a var here to make the build fail loudly when it's unset.
const REQUIRED_CLIENT_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

// Client env vars the app degrades without but still renders (maps, OAuth redirect).
// Missing → warn, never fail.
const RECOMMENDED_CLIENT_ENV = ["VITE_MAPBOX_TOKEN", "VITE_SITE_URL"];

// Build-only guard: abort the build when a required VITE_* client var is missing.
// `apply: 'build'` keeps it completely inert during `npm run dev` / `ios:live` /
// live reload, so it can never block local iteration - it only runs for
// `vite build` (web prod, `build:dev`, and the `build:ios` Capacitor build).
// Only guards public VITE_* client vars; server-only secrets
// (SUPABASE_SERVICE_ROLE_KEY, RESEND_*) are not part of the client build.
function envGuard(mode: string): Plugin {
  return {
    name: "dormcheck-env-guard",
    apply: "build",
    config() {
      // Merge both sources: Vercel injects build-time vars into process.env;
      // local .env files are read by loadEnv. process.env wins (CI is canonical).
      const fileEnv = loadEnv(mode, process.cwd(), "");
      const env = { ...fileEnv, ...process.env };
      const isSet = (k: string) => typeof env[k] === "string" && env[k].trim() !== "";

      const missingRequired = REQUIRED_CLIENT_ENV.filter((k) => !isSet(k));
      const missingRecommended = RECOMMENDED_CLIENT_ENV.filter((k) => !isSet(k));

      for (const k of missingRecommended) {
        console.warn(
          `\n⚠️  [env-guard] Recommended env var ${k} is not set. The app will build and render, ` +
            `but the feature it powers will degrade (maps / OAuth redirect). ` +
            `Set it in the Vercel project env (and .env locally).\n`,
        );
      }

      if (missingRequired.length > 0) {
        const list = missingRequired.map((k) => `  • ${k}`).join("\n");
        throw new Error(
          `\n\n❌ [env-guard] Aborting build - required client env var(s) missing or empty:\n${list}\n\n` +
            `These are read by src/integrations/supabase/client.ts and a missing one ships a fully blank page.\n` +
            `Set them in the Vercel project Environment Variables (Settings → Environment Variables) ` +
            `for the deploying environment, and in .env locally. Then redeploy.\n`,
        );
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: process.env.CAPACITOR ? "./" : "/",
  // Worktree/second-server support: node_modules/.vite is shared through the
  // symlinked node_modules, and two concurrent vite processes corrupt it.
  // A session-scoped VITE_CACHE_DIR gives each server its own dep cache.
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  server: {
    // Loopback only by default, so :8080 is not reachable from whatever network
    // the Mac is on. Simulator, emulator (10.0.2.2 / adb reverse) and browser all
    // reach loopback. VITE_LAN=1 opts in to all interfaces for a physical device.
    host: process.env.VITE_LAN === "1" ? "::" : "localhost",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Don't watch native build output / bundles - iOS DerivedData and synced
    // build products churn constantly and would flood HMR with page reloads.
    watch: {
      ignored: ["**/ios/**", "**/android/**", "**/dist/**"],
    },
  },
  plugins: [envGuard(mode), react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-dialog",
      "@radix-ui/react-toast",
    ],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router",
      "@tanstack/react-query",
      "@supabase/supabase-js",
    ],
  },
  build: {
    sourcemap: false,
    minify: "esbuild",
    target: "es2020",
    chunkSizeWarningLimit: 1700,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
      },
      output: {
        // NOTE: do NOT add a `mapbox-gl -> "mapbox-vendor"` rule back here.
        // The bundler parks its own shared runtime helper (`__vite__preload`,
        // imported by every chunk that contains a dynamic import(), and NOT
        // steerable from this function) inside one of the named manual chunks.
        // It picked mapbox-vendor, which made the 1.8 MB map bundle a *static*
        // dependency of the entry: 1.8 MB of Mapbox on first paint of the
        // landing page and /waitlist, neither of which renders a map. With no
        // manual chunk to attach to, mapbox-gl is placed by its real importers
        // - all of them lazy - and stays off the critical path as one shared
        // async chunk. Re-verify with `node scripts/check-first-paint.mjs`
        // after any change to this function.
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/react-router")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@tanstack/react-query")) {
            return "query-vendor";
          }
          if (id.includes("node_modules/@supabase/")) {
            return "supabase-vendor";
          }
          if (id.includes("node_modules/recharts")) {
            return "recharts-vendor";
          }
          if (id.includes("node_modules/framer-motion")) {
            return "motion-vendor";
          }
        },
      },
    },
  },
}));