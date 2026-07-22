const defaultApiUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';

export const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl;

export const INSTALLATION_OPERATOR_URL =
  import.meta.env.VITE_INSTALLATION_OPERATOR_URL || 'https://ops.setly.tech';
