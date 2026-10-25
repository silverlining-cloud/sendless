import type { ZodType } from 'zod';
import type { ApiErrorBody } from '@s3ndless/shared';

export interface HttpRequest {
  method: string;
  path: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  query: Record<string, string>;
  body: string | undefined;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
}

export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (message: string, code = 'invalid_request') => new HttpError(400, code, message);
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
export const gone = (message: string, code = 'expired') => new HttpError(410, code, message);

export function json(statusCode: number, data: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(data),
  };
}

export function noContent(): HttpResponse {
  return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
}

export function errorResponse(error: HttpError): HttpResponse {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
  return json(error.status, body);
}

export function parseBody<T>(req: HttpRequest, schema: ZodType<T>): T {
  let raw: unknown = {};
  if (req.body) {
    try {
      raw = JSON.parse(req.body);
    } catch {
      throw badRequest('Request body must be valid JSON');
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${where}${issue?.message ?? 'Invalid request'}`);
  }
  return result.data;
}

/** Shape of a Lambda function URL (payload format 2.0) event, reduced to what we use. */
export interface FunctionUrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    http: { method: string; sourceIp?: string; userAgent?: string };
  };
}

export function fromFunctionUrlEvent(event: FunctionUrlEvent): HttpRequest {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined) query[key] = value;
  }
  const body =
    event.body === undefined
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
  return {
    method: event.requestContext.http.method.toUpperCase(),
    path: event.rawPath,
    headers,
    query,
    body,
    ip: viewerIp(headers) ?? event.requestContext.http.sourceIp ?? null,
    country: headers['cloudfront-viewer-country'] ?? null,
    userAgent: headers['user-agent'] ?? event.requestContext.http.userAgent ?? null,
  };
}

/** The viewer's IP: CloudFront-Viewer-Address ("ip:port") or the first X-Forwarded-For entry. */
function viewerIp(headers: Record<string, string>): string | null {
  const address = headers['cloudfront-viewer-address'];
  if (address) return address.slice(0, address.lastIndexOf(':')).replace(/^\[|\]$/g, '');
  const forwarded = headers['x-forwarded-for'];
  return forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null;
}
