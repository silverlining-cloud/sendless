import { createApp, type App } from '../app.js';
import { fromFunctionUrlEvent, type FunctionUrlEvent } from '../http.js';
import { awsDeps } from '../runtime.js';

let app: App | undefined;

/** Lambda function URL handler, reachable only through CloudFront (OAC + AWS_IAM). */
export async function handler(event: FunctionUrlEvent) {
  app ??= createApp(awsDeps());
  const response = await app(fromFunctionUrlEvent(event));
  return { statusCode: response.statusCode, headers: response.headers ?? {}, body: response.body ?? '' };
}
