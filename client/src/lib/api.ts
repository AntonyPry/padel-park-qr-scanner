import { API_URL } from '@/config';
import {
  applyTenantHeaders,
  cancelTenantSensitiveRequests,
  clearActiveTenantContext,
  getTenantRequestSignal,
  setTenantContextCapability,
} from '@/lib/tenant-context';
import {
  clearStoredActiveOnboardingQuestAfterProgress,
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuestForPath,
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
  ONBOARDING_QUEST_ROLE_HEADER,
  ONBOARDING_QUEST_TASK_HEADER,
} from '@/lib/onboarding-quest';

const AUTH_TOKEN_KEY = 'padel_park_auth_token';
const TRAINING_MODE_KEY = 'padel_park_training_mode';

interface StoredTrainingMode {
  isEnabled: boolean;
  role?: string | null;
}

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  clearStoredTrainingMode();
  cancelTenantSensitiveRequests();
  clearActiveTenantContext();
  setTenantContextCapability(false);
  clearStoredActiveOnboardingQuest();
}

export function getStoredTrainingMode() {
  try {
    const rawValue = localStorage.getItem(TRAINING_MODE_KEY);
    return rawValue ? (JSON.parse(rawValue) as StoredTrainingMode) : null;
  } catch {
    return null;
  }
}

export function setStoredTrainingMode(value: StoredTrainingMode) {
  localStorage.setItem(TRAINING_MODE_KEY, JSON.stringify(value));
}

export function clearStoredTrainingMode() {
  localStorage.removeItem(TRAINING_MODE_KEY);
}

function readTaskKeysHeader(response: Response, headerName: string) {
  return (response.headers.get(headerName) || '')
    .split(',')
    .map((taskKey) => taskKey.trim())
    .filter(Boolean);
}

export function applyOnboardingProgressResponse(response: Response) {
  if (!response.ok) return null;

  return clearStoredActiveOnboardingQuestAfterProgress({
    completedTaskKeys: readTaskKeysHeader(
      response,
      ONBOARDING_COMPLETED_TASKS_HEADER,
    ),
    progressedTaskKeys: readTaskKeysHeader(
      response,
      ONBOARDING_PROGRESSED_TASKS_HEADER,
    ),
  });
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  const isFormData = init.body instanceof FormData;
  const trainingMode = getStoredTrainingMode();
  const activeQuest =
    typeof window === 'undefined'
      ? null
      : getStoredActiveOnboardingQuestForPath(window.location.pathname);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  applyTenantHeaders(input, init, headers);

  if (trainingMode?.isEnabled) {
    headers.set('X-Training-Mode', 'true');
    if (trainingMode.role) {
      headers.set('X-Training-Role', trainingMode.role);
    }
  }

  if (activeQuest) {
    headers.set(ONBOARDING_QUEST_TASK_HEADER, activeQuest.taskKey);
    if (activeQuest.role) {
      headers.set(ONBOARDING_QUEST_ROLE_HEADER, activeQuest.role);
    }
  }

  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = input.startsWith('http') ? input : `${API_URL}${input}`;
  const response = await fetch(url, {
    ...init,
    headers,
    signal: getTenantRequestSignal(input, init),
  });

  applyOnboardingProgressResponse(response);

  if (response.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new Event('auth:expired'));
  }

  return response;
}

export class ApiRequestError extends Error {
  code?: string;
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as {
      code?: string;
      details?: unknown;
      error?: string;
    };

    return {
      code: data.code,
      details: data.details,
      message: data.error || fallback,
    };
  } catch {
    return {
      code: undefined,
      details: undefined,
      message: fallback,
    };
  }
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message || fallback : fallback;
}

export async function apiRequest<T>(
  input: string,
  init: RequestInit = {},
  fallback = 'Ошибка запроса',
) {
  const response = await apiFetch(input, init);

  if (!response.ok) {
    const apiError = await readApiError(response, fallback);
    throw new ApiRequestError(
      apiError.message,
      response.status,
      apiError.details,
      apiError.code,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
