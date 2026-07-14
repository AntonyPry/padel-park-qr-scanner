import { createContext } from 'react';
import type { AccountRole } from '@/lib/roles';
import type { ActiveTenantContext } from '@/lib/tenant-context';

interface StaffProfile {
  id: number;
  name: string;
  role: string;
  phone?: string | null;
  status: string;
}

export interface Account {
  id: number;
  email: string;
  role: AccountRole;
  status: 'active' | 'inactive' | 'archived';
  staffId?: number | null;
  lastLoginAt?: string | null;
  Staff?: StaffProfile | null;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface BootstrapData extends Credentials {
  name: string;
  phone?: string;
}

export interface AuthContextValue {
  account: Account | null;
  loading: boolean;
  setupRequired: boolean;
  tenantContext: ActiveTenantContext | null;
  tenantContextEnabled: boolean;
  tenantReady: boolean;
  login: (credentials: Credentials) => Promise<void>;
  bootstrap: (data: BootstrapData) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
