import type { AccountRole } from '../constants/account-roles';

declare global {
  namespace Express {
    interface Request {
      account?: {
        id: number;
        role: AccountRole;
        status?: string;
        Staff?: {
          status?: string;
        } | null;
        [key: string]: unknown;
      };
      authentication?: {
        accountId: number;
        expiresAt: number;
        kind: 'legacy' | 'opaque';
        sessionId?: string;
      };
      identityAccount?: Request['account'];
      tenant?: {
        accountId: number;
        membershipId: number | null;
        organizationId: number | null;
        clubId: number | null;
        membershipRole: AccountRole | null;
        effectiveRole: AccountRole | null;
        scope: 'global' | 'membership' | 'organization' | 'club';
      };
      tenantRoute?: {
        classification:
          | 'global'
          | 'membership'
          | 'organization'
          | 'club'
          | 'provider_ingress'
          | 'worker';
        id: string;
        method: string;
        path: string;
        public: boolean;
      } | null;
      trainingMode?: {
        requested: boolean;
        role?: AccountRole;
      };
      onboardingQuest?: {
        role?: AccountRole;
        taskKey: string;
      };
    }
  }
}

export {};
