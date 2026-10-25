import { HttpError, type HttpRequest, type HttpResponse } from './http.js';

export type RouteHandler = (req: HttpRequest, params: Record<string, string>) => Promise<HttpResponse>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

/** Minimal path router: `/api/transfers/{id}` style patterns, exact segment matching. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method: method.toUpperCase(), segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler) {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: RouteHandler) {
    return this.add('POST', pattern, handler);
  }
  put(pattern: string, handler: RouteHandler) {
    return this.add('PUT', pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler) {
    return this.add('PATCH', pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler) {
    return this.add('DELETE', pattern, handler);
  }

  async handle(req: HttpRequest): Promise<HttpResponse> {
    const segments = split(req.path);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = match(route.segments, segments);
      if (!params) continue;
      pathMatched = true;
      if (route.method === req.method) return route.handler(req, params);
    }
    if (pathMatched) throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed here`);
    throw new HttpError(404, 'route_not_found', 'Unknown API route');
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function match(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i]!;
    const value = actual[i]!;
    if (expected.startsWith('{') && expected.endsWith('}')) {
      try {
        params[expected.slice(1, -1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (expected !== value) {
      return null;
    }
  }
  return params;
}
