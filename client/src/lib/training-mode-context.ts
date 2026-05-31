import { createContext } from 'react';
import type { AccountRole } from '@/lib/roles';

export interface TrainingModeState {
  disabledAt: string | null;
  enabledAt: string | null;
  isEnabled: boolean;
  role: AccountRole | null;
}

export interface TrainingModeContextValue {
  disable: () => Promise<void>;
  enable: (role?: AccountRole) => Promise<void>;
  loading: boolean;
  setMode: (payload: { isEnabled: boolean; role?: AccountRole }) => Promise<void>;
  state: TrainingModeState;
}

export const TrainingModeContext =
  createContext<TrainingModeContextValue | null>(null);
