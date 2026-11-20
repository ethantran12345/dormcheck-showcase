import { useState, useEffect, useCallback } from 'react';

export interface UserProfileData {
  gradeLevel: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';
  major: string;
  currentDorm: string;
  currentFloor: string | null;
  name: string;
  onboardingComplete: boolean;
}

const STORAGE_KEY = 'pitt_housing_user_profile';

const DEFAULT_PROFILE: UserProfileData = {
  gradeLevel: 'Freshman',
  major: 'Undeclared',
  currentDorm: 'Tower A',
  currentFloor: null,
  name: 'Student',
  onboardingComplete: false,
};

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfileData>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_PROFILE, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Failed to load user profile:', e);
    }
    return DEFAULT_PROFILE;
  });

  // Persist to localStorage whenever profile changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error('Failed to save user profile:', e);
    }
  }, [profile]);

  const updateProfile = useCallback((updates: Partial<UserProfileData>) => {
    setProfile(prev => ({ ...prev, ...updates }));
  }, []);

  const completeOnboarding = useCallback((data: Pick<UserProfileData, 'gradeLevel' | 'major' | 'currentDorm'>) => {
    setProfile(prev => ({
      ...prev,
      ...data,
      onboardingComplete: true,
    }));
  }, []);

  const resetProfile = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfile(DEFAULT_PROFILE);
  }, []);

  return {
    profile,
    updateProfile,
    completeOnboarding,
    resetProfile,
    isOnboarded: profile.onboardingComplete,
  };
}
