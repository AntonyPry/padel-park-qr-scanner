import { createContext, useContext } from 'react';

export interface ShiftSession {
  id: number;
  date: string;
  staffId?: number | null;
  adminName: string;
  startedAt: string;
  endedAt?: string | null;
  status: 'active' | 'closed' | 'draft' | 'approved';
  Staff?: {
    id: number;
    name: string;
    role: string;
  } | null;
}

export interface ShiftWorkspaceContextValue {
  activeShift: ShiftSession | null;
  loaded: boolean;
  now: number;
  refreshActiveShift: () => Promise<void>;
  setActiveShift: (shift: ShiftSession | null) => void;
  startShift: () => Promise<void>;
  starting: boolean;
  statusError: string;
}

export const ShiftWorkspaceContext =
  createContext<ShiftWorkspaceContextValue | null>(null);

export function formatShiftDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function useShiftWorkspaceOptional() {
  return useContext(ShiftWorkspaceContext);
}

export function useShiftWorkspace() {
  const value = useShiftWorkspaceOptional();
  if (!value) {
    throw new Error('useShiftWorkspace must be used inside ShiftWorkspaceProvider');
  }
  return value;
}
