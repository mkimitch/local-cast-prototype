type ViteEnv = Record<string, string | boolean | undefined>;

interface ViteImportMeta extends ImportMeta {
  env?: ViteEnv;
}

export type ServiceMode = 'api';

const env = ((import.meta as ViteImportMeta).env || {}) as ViteEnv;

export const getServiceMode = (): ServiceMode => {
  const configured = typeof env.VITE_SERVICE_MODE === 'string' ? env.VITE_SERVICE_MODE.toLowerCase() : undefined;
  if (configured && configured !== 'api') {
    throw new Error('LocalCast browser services must use the same-origin API');
  }
  return 'api';
};

const configuredBaseUrl = typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : '/api';
if (env.PROD === true && !configuredBaseUrl.startsWith('/')) {
  throw new Error('Production LocalCast API URL must be same-origin');
}

export const apiBaseUrl = configuredBaseUrl.replace(/\/+$/, '');

export class HttpClientError extends Error {
  constructor(public readonly status: number, message: string, public readonly payload: unknown) {
    super(message);
    this.name = 'HttpClientError';
  }
}

export const apiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => undefined) as unknown;

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : response.statusText;
    throw new HttpClientError(response.status, message, payload);
  }

  return payload as T;
};
