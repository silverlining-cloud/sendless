import { CONTENT_SHA256_HEADER, TOKEN_HEADER, type ApiErrorBody } from '@sendless/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;
let onUnauthorized: () => void = () => {};

/** Wired up by the AuthProvider. */
export function configureAuth(provider: TokenProvider, unauthorized: () => void) {
  tokenProvider = provider;
  onUnauthorized = unauthorized;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RequestOptions {
  /** Attach the signed-in user's token (default true; public pages pass false). */
  auth?: boolean;
  signal?: AbortSignal;
}

/**
 * Calls the Sendless API. Writes carry `x-amz-content-sha256`, which CloudFront's origin
 * access control requires for Lambda function URLs; the user token goes in its own header
 * because CloudFront replaces `Authorization` with its SigV4 signature.
 */
export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers[CONTENT_SHA256_HEADER] = await sha256Hex(payload ?? '');
  if (opts.auth !== false) {
    const token = await tokenProvider();
    if (token) headers[TOKEN_HEADER] = token;
  }
  const response = await fetch(path, { method, headers, body: payload ?? null, signal: opts.signal ?? null });
  return parseResponse<T>(response, opts.auth !== false);
}

async function parseResponse<T>(response: Response, authenticated: boolean): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // CloudFront and Lambda URL errors are not JSON.
  }
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    if (response.status === 401 && authenticated && error?.code === 'unauthorized') onUnauthorized();
    throw new ApiError(response.status, error?.code ?? `http_${response.status}`, error?.message ?? (response.statusText || 'Request failed'));
  }
  return data as T;
}

/** Fetches a file response (e.g. CSV export) with auth, returning the raw Response. */
export async function requestRaw(path: string): Promise<Response> {
  const token = await tokenProvider();
  const response = await fetch(path, { headers: token ? { [TOKEN_HEADER]: token } : {} });
  if (!response.ok) await parseResponse(response, true);
  return response;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>('PUT', path, body, opts),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  delete: <T = void>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

export const publicApi = {
  get: <T>(path: string) => request<T>('GET', path, undefined, { auth: false }),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body, { auth: false }),
};
