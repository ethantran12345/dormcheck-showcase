import { lazy } from "react";
import { Route } from "react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AuthPage from "@/pages/auth/Auth";
import AuthCallback from "@/pages/auth/AuthCallback";
import SelectSchool from "@/pages/auth/SelectSchool";

const OnboardingIntro = lazy(() => import("@/pages/auth/OnboardingIntro"));

/**
 * Auth boundary routes - shared across web and native (the native guard mounts
 * these alongside the User App zone).
 */
export function AuthRoutes() {
  return (
    <>
      <Route path="/select-school" element={<SelectSchool />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/v1/callback" element={<AuthCallback />} />
      <Route path="/onboarding/intro" element={<ProtectedRoute><OnboardingIntro /></ProtectedRoute>} />
    </>
  );
}
