import { API_URL } from '@/config';

const AUTH_TOKEN_KEY = 'padel_park_auth_token';

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  const isFormData = init.body instanceof FormData;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = input.startsWith('http') ? input : `${API_URL}${input}`;
  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new Event('auth:expired'));
  }

  return response;
}

export class ApiRequestError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
}

export async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as {
      details?: unknown;
      error?: string;
    };

    return {
      details: data.details,
      message: data.error || fallback,
    };
  } catch {
    return {
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
    throw new ApiRequestError(apiError.message, response.status, apiError.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
