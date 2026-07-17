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
