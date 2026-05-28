import type { Response } from 'express';

interface ApiErrorLike {
  statusCode?: number;
  message?: string;
  code?: string;
  details?: unknown;
  client?: unknown;
}

interface ApiErrorPayload {
  error: string;
  status: number;
  code?: string;
  details?: unknown;
  client?: unknown;
}

function sendError(
  res: Response,
  error: ApiErrorLike = {},
  fallback = 'Ошибка сервера',
) {
  const status = error.statusCode || 500;
  const exposeMessage = status < 500;
  const payload: ApiErrorPayload = {
    error: exposeMessage ? error.message || fallback : fallback,
    status,
  };

  if (error.code) payload.code = error.code;
  if (error.details) payload.details = error.details;
  if (error.client) payload.client = error.client;

  res.status(status).json(payload);
}

module.exports = {
  sendError,
};
