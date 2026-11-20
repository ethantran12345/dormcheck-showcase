import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { devLog } from '@/lib/utils';

export function useSavedDorms() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [savedDormIds, setSavedDormIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);

  // Fetch saved dorms on mount
  useEffect(() => {
    if (!user) {
      hasLoadedOnce.current = false;
      setSavedDormIds(new Set());
      setIsLoading(false);
      return;
    }

    const fetchSavedDorms = async () => {
      if (!hasLoadedOnce.current) {
        setIsLoading(true);
      }
      try {
        const { data, error } = await supabase
          .from('saved_dorms')
          .select('dorm_id')
          .eq('user_id', user.id);

        if (error) throw error;

        // saved_dorms.dorm_id references master_housing.id
        const ids = new Set(data?.map(d => String(d.dorm_id)) || []);
        setSavedDormIds(ids);
      } catch (error) {
        console.error('Error fetching saved dorms:', error);
      } finally {
        setIsLoading(false);
        hasLoadedOnce.current = true;
      }
    };

    fetchSavedDorms();
  }, [user]);

  const toggleSave = useCallback(async (dormId: string): Promise<boolean> => {
    if (!user) {
      console.warn('toggleSave called without user');
      return false;
    }

    const currentlySaved = savedDormIds.has(dormId);
    
    // Optimistic update
    setSavedDormIds(prev => {
      const next = new Set(prev);
      if (currentlySaved) {
        next.delete(dormId);
      } else {
        next.add(dormId);
      }
      return next;
    });

    try {
      // dorm_id in saved_dorms references master_housing.id (numeric). Dorm.id is String(master_housing.id).
      const parts = dormId.split('-');
      const numericPart = parts[parts.length - 1];
      const numericDormId = parseInt(numericPart, 10);
      
      if (isNaN(numericDormId)) {
        console.error('Invalid dorm ID format:', dormId);
        throw new Error('Invalid dorm ID');
      }

      if (currentlySaved) {
        // Remove from both user_dorm_rankings and saved_dorms (linked deletion)
        const [rankingsResult, savedResult] = await Promise.all([
          supabase
            .from('user_dorm_rankings')
            .delete()
            .eq('user_id', user.id)
            .eq('dorm_id', numericDormId),
          supabase
            .from('saved_dorms')
            .delete()
            .eq('user_id', user.id)
            .eq('dorm_id', numericDormId)
            .select(),
        ]);

        if (rankingsResult.error) {
          console.error('Delete user_dorm_rankings error:', rankingsResult.error.message);
          throw rankingsResult.error;
        }
        if (savedResult.error) {
          console.error('Delete saved_dorms error:', savedResult.error.message);
          throw savedResult.error;
        }

        void queryClient.invalidateQueries({ queryKey: ['saved_dorms_and_user_dorm_rankings'] });

        toast('Removed from saved', {
          description: 'This dorm has been removed from your saved list.',
        });

        return false; // Now unsaved
      } else {
        // Auto-profile: ensure profile exists to prevent FK errors
        const { data: existingProfile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
        if (!existingProfile) {
          const { error: upsertErr } = await supabase.from('profiles').upsert(
            { id: user.id, full_name: (user.user_metadata?.full_name as string) ?? user.email?.split('@')[0] ?? null, email: user.email ?? null },
            { onConflict: 'id' }
          );
          if (upsertErr) {
            console.error('[useSavedDorms] Profile auto-create failed:', upsertErr.code, upsertErr.message);
            throw upsertErr;
          }
        }

        const { data, error } = await supabase
          .from('saved_dorms')
          .insert([{ user_id: user.id, dorm_id: numericDormId }])
          .select();

        if (error) {
          console.error('Insert error details:', {
            error,
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
            user_id: user.id,
            dorm_id: numericDormId
          });
          throw error;
        }
        
        devLog('Insert successful:', data);

        toast.success('Saved successfully', {
          description: 'This dorm has been added to your saved list.',
        });
        
        return true; // Now saved
      }
    } catch (error) {
      console.error('Error toggling save - Full error object:', error);

      const err = error as { code?: string; message?: string; details?: string; hint?: string };
      const rootCause = (() => {
        const code = err?.code ? `code=${String(err.code)}` : null;
        const message = err?.message ? `message=${String(err.message)}` : null;
        const details = err?.details ? `details=${String(err.details)}` : null;
        const hint = err?.hint ? `hint=${String(err.hint)}` : null;
        const parts = [code, message, details, hint].filter(Boolean);
        return parts.length ? parts.join(' • ') : null;
      })();

      toast.error('Error', {
        description: rootCause ? `Unable to save dorm. ${rootCause}` : 'Unable to save dorm. Please try again.',
      });

      // Revert optimistic update on error
      setSavedDormIds(prev => {
        const next = new Set(prev);
        if (currentlySaved) {
          next.add(dormId);
        } else {
          next.delete(dormId);
        }
        return next;
      });
      return currentlySaved; // Return original state
    }
  }, [user, savedDormIds]);


  const isSaved = useCallback((dormId: string): boolean => {
    return savedDormIds.has(dormId);
  }, [savedDormIds]);

  return {
    savedDormIds,
    isSaved,
    toggleSave,
    isLoading,
    isLoggedIn: !!user,
  };
}
