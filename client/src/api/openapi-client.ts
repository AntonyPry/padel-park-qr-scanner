import { ApiRequestError, apiFetch, readApiError } from '@/lib/api';
import {
  apiEndpoints,
  type ApiEndpointId,
  type ApiEndpointRequestMap,
  type ApiEndpointResponseMap,
} from './generated';

type Primitive = boolean | number | string | null | undefined;
type RequestInput<TEndpoint extends ApiEndpointId> = ApiEndpointRequestMap[TEndpoint] & {
  signal?: AbortSignal;
};

function replacePathParams(path: string, params?: Record<string, Primitive>) {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Не указан параметр пути: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

function appendQuery(path: string, query?: Record<string, Primitive | Primitive[]>) {
  if (!query) return path;

  const searchParams = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          searchParams.append(key, String(item));
        }
      });
      return;
    }
    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function openApiRequest<
  TEndpoint extends ApiEndpointId = ApiEndpointId,
  TResponse = ApiEndpointResponseMap[TEndpoint],
>(
  endpointId: TEndpoint,
  input = {} as RequestInput<TEndpoint>,
  fallback = 'Ошибка запроса',
) {
  const endpoint = apiEndpoints[endpointId];
  const params = 'params' in input ? (input.params as Record<string, Primitive>) : undefined;
  const query = 'query' in input ? (input.query as Record<string, Primitive | Primitive[]>) : undefined;
  const body = 'body' in input ? input.body : undefined;
  const path = appendQuery(replacePathParams(endpoint.path, params), query);
  const response = await apiFetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    method: endpoint.method,
    signal: input.signal,
  });

  if (!response.ok) {
    const apiError = await readApiError(response, fallback);
    throw new ApiRequestError(
      apiError.message,
      response.status,
      apiError.details,
      apiError.code,
    );
  }

  if (response.status === 204) return undefined as TResponse;
  if (endpoint.responseType === 'blob') return (await response.blob()) as TResponse;
  return (await response.json()) as TResponse;
}

export type { ApiEndpointId, ApiEndpointRequestMap };
