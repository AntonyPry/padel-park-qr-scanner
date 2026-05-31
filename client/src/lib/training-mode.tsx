import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOnboardingTrainingMode,
  setOnboardingTrainingMode,
} from '@/api/onboarding';
import { queryKeys } from '@/api/query-keys';
import {
  clearStoredTrainingMode,
  setStoredTrainingMode,
} from '@/lib/api';
import { TrainingModeContext } from '@/lib/training-mode-context';
import type { AccountRole } from '@/lib/roles';
import { useAuth } from '@/lib/useAuth';

const EMPTY_STATE = {
  disabledAt: null,
  enabledAt: null,
  isEnabled: false,
  role: null,
};

export function TrainingModeProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const trainingModeQuery = useQuery({
    enabled: Boolean(account?.id),
    queryFn: getOnboardingTrainingMode,
    queryKey: queryKeys.onboarding.trainingMode(),
  });
  const updateMutation = useMutation({
    mutationFn: setOnboardingTrainingMode,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.onboarding.trainingMode(), data);
    },
  });

  const state = useMemo(
    () =>
      trainingModeQuery.data
        ? {
            disabledAt: trainingModeQuery.data.disabledAt,
            enabledAt: trainingModeQuery.data.enabledAt,
            isEnabled: trainingModeQuery.data.isEnabled,
            role: trainingModeQuery.data.role,
          }
        : EMPTY_STATE,
    [trainingModeQuery.data],
  );

  useEffect(() => {
    if (!account?.id) {
      clearStoredTrainingMode();
      return;
    }

    if (state.isEnabled) {
      setStoredTrainingMode({ isEnabled: true, role: state.role });
    } else {
      clearStoredTrainingMode();
    }
  }, [account?.id, state.isEnabled, state.role]);

  const setMode = useCallback(
    async (payload: { isEnabled: boolean; role?: AccountRole }) => {
      const nextState = await updateMutation.mutateAsync(payload);
      if (nextState.isEnabled) {
        setStoredTrainingMode({ isEnabled: true, role: nextState.role });
      } else {
        clearStoredTrainingMode();
      }
    },
    [updateMutation],
  );

  const enable = useCallback(
    (role?: AccountRole) => setMode({ isEnabled: true, role }),
    [setMode],
  );
  const disable = useCallback(
    () => setMode({ isEnabled: false, role: state.role || undefined }),
    [setMode, state.role],
  );

  const value = useMemo(
    () => ({
      disable,
      enable,
      loading: trainingModeQuery.isLoading || updateMutation.isPending,
      setMode,
      state,
    }),
    [
      disable,
      enable,
      setMode,
      state,
      trainingModeQuery.isLoading,
      updateMutation.isPending,
    ],
  );

  return (
    <TrainingModeContext.Provider value={value}>
      {children}
    </TrainingModeContext.Provider>
  );
}
