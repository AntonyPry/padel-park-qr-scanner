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
