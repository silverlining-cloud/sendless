import {
  completeFileInput,
  createRequestInput,
  createTransferInput,
  downloadInput,
  inviteUserInput,
  licenseInput,
  partUrlsInput,
  settingsSchema,
  submissionInput,
  TOKEN_HEADER,
  unlockInput,
  updateUserInput,
  uploadTokenInput,
  type ProFeature,
} from '@s3ndless/shared';
import { registerProRoutes } from '@s3ndless/ee/api';
import { editionFor, hasFeature } from './edition.js';
import {
  badRequest,
  errorResponse,
  forbidden,
  HttpError,
  json,
  noContent,
  parseBody,
  unauthorized,
  type HttpRequest,
  type HttpResponse,
} from './http.js';
import type { Deps, Principal, ProRouteContext } from './ports.js';
import { Router } from './router.js';
import * as admin from './services/admin.js';
import { publicConfig } from './services/config.js';
import * as requests from './services/requests.js';
import * as transfers from './services/transfers.js';

export type App = (req: HttpRequest) => Promise<HttpResponse>;

export function createApp(deps: Deps): App {
  const requireUser = async (req: HttpRequest): Promise<Principal> => {
    const token = req.headers[TOKEN_HEADER];
    if (!token) throw unauthorized();
    const principal = await deps.auth.authenticate(token);
    if (!principal) throw unauthorized('Your session has expired. Please sign in again.');
    return principal;
  };
  const requireAdmin = async (req: HttpRequest): Promise<Principal> => {
    const principal = await requireUser(req);
    if (!principal.isAdmin) throw forbidden('Administrators only');
    return principal;
  };
  const requireFeature = async (feature: ProFeature): Promise<void> => {
    const edition = editionFor(await deps.settings(), deps.now());
    if (!hasFeature(edition, feature)) {
      throw forbidden('This feature requires an S3ndless Pro license', 'pro_required');
    }
  };
  const kindParam = (value: string | undefined) => {
    if (value === undefined || value === 'outbound') return 'outbound' as const;
    if (value === 'inbound') return 'inbound' as const;
    throw badRequest('kind must be outbound or inbound');
  };

  const r = new Router();

  // ----- public: recipients and uploaders, no account -----
  r.get('/api/public/config', async () => json(200, await publicConfig(deps)));
  r.get('/api/public/transfers/{id}', async (_req, p) => json(200, await transfers.getPublicTransfer(deps, p.id!)));
  r.post('/api/public/transfers/{id}/unlock', async (req, p) => {
    const { password } = parseBody(req, unlockInput);
    return json(200, await transfers.unlockTransfer(deps, p.id!, password, req));
  });
  r.post('/api/public/transfers/{id}/files/{fileId}/download', async (req, p) => {
    const { sessionId } = parseBody(req, downloadInput);
    return json(200, await transfers.sessionDownload(deps, p.id!, p.fileId!, sessionId, req));
  });
  r.get('/api/public/requests/{id}', async (_req, p) => json(200, await requests.getPublicRequest(deps, p.id!)));
  r.post('/api/public/requests/{id}/submissions', async (req, p) =>
    json(201, await requests.submitToRequest(deps, p.id!, parseBody(req, submissionInput), req)),
  );
  r.post('/api/public/uploads/{transferId}/files/{fileId}/parts', async (req, p) =>
    json(200, { parts: await transfers.presignParts(deps, p.transferId!, p.fileId!, parseBody(req, partUrlsInput)) }),
  );
  r.post('/api/public/uploads/{transferId}/files/{fileId}/complete', async (req, p) => {
    await transfers.completeFile(deps, p.transferId!, p.fileId!, parseBody(req, completeFileInput));
    return noContent();
  });
  r.post('/api/public/uploads/{transferId}/finalize', async (req, p) => {
    const { uploadToken } = parseBody(req, uploadTokenInput);
    return json(200, await transfers.finalizeUpload(deps, p.transferId!, uploadToken, req));
  });
  r.post('/api/public/uploads/{transferId}/abort', async (req, p) => {
    const { uploadToken } = parseBody(req, uploadTokenInput);
    await transfers.abortUpload(deps, p.transferId!, uploadToken, req);
    return noContent();
  });

  // ----- signed-in users -----
  r.get('/api/me', async (req) => json(200, admin.me(await requireUser(req))));
  r.get('/api/transfers', async (req) =>
    json(200, await transfers.listTransfers(deps, await requireUser(req), kindParam(req.query.kind), req.query.cursor ?? null)),
  );
  r.post('/api/transfers', async (req) => {
    const principal = await requireUser(req);
    return json(201, await transfers.createTransfer(deps, principal, parseBody(req, createTransferInput), req));
  });
  r.get('/api/transfers/{id}', async (req, p) => json(200, await transfers.getTransfer(deps, await requireUser(req), p.id!)));
  r.delete('/api/transfers/{id}', async (req, p) => {
    await transfers.revokeTransfer(deps, await requireUser(req), p.id!, req);
    return noContent();
  });
  r.post('/api/transfers/{id}/files/{fileId}/download', async (req, p) =>
    json(200, await transfers.ownerDownload(deps, await requireUser(req), p.id!, p.fileId!, req)),
  );
  r.get('/api/requests', async (req) =>
    json(200, await requests.listRequests(deps, await requireUser(req), req.query.cursor ?? null)),
  );
  r.post('/api/requests', async (req) => {
    const principal = await requireUser(req);
    return json(201, await requests.createRequest(deps, principal, parseBody(req, createRequestInput), req));
  });
  r.get('/api/requests/{id}', async (req, p) => json(200, await requests.getRequest(deps, await requireUser(req), p.id!)));
  r.delete('/api/requests/{id}', async (req, p) => {
    await requests.revokeRequest(deps, await requireUser(req), p.id!, req);
    return noContent();
  });

  // ----- administrators -----
  r.get('/api/admin/settings', async (req) => {
    await requireAdmin(req);
    return json(200, await admin.getAdminSettings(deps));
  });
  r.put('/api/admin/settings', async (req) => {
    const principal = await requireAdmin(req);
    return json(200, await admin.updateSettings(deps, principal, parseBody(req, settingsSchema), req));
  });
  r.put('/api/admin/license', async (req) => {
    const principal = await requireAdmin(req);
    return json(200, await admin.setLicense(deps, principal, parseBody(req, licenseInput).key, req));
  });
  r.get('/api/admin/users', async (req) => {
    await requireAdmin(req);
    return json(200, { items: await admin.listUsers(deps) });
  });
  r.post('/api/admin/users', async (req) => {
    const principal = await requireAdmin(req);
    const { email, admin: isAdmin } = parseBody(req, inviteUserInput);
    return json(201, await admin.inviteUser(deps, principal, email, isAdmin, req));
  });
  r.patch('/api/admin/users/{username}', async (req, p) => {
    const principal = await requireAdmin(req);
    await admin.updateUser(deps, principal, p.username!, parseBody(req, updateUserInput), req);
    return noContent();
  });
  r.delete('/api/admin/users/{username}', async (req, p) => {
    const principal = await requireAdmin(req);
    await admin.deleteUser(deps, principal, p.username!, req);
    return noContent();
  });

  const pro: ProRouteContext = { deps, requireAdmin, requireFeature };
  registerProRoutes(r, pro);

  return async (req) => {
    const started = Date.now();
    let response: HttpResponse;
    try {
      response = await r.handle(req);
    } catch (error) {
      if (error instanceof HttpError) {
        response = errorResponse(error);
      } else {
        deps.log.error('unhandled error', { method: req.method, path: req.path, error });
        response = errorResponse(new HttpError(500, 'internal', 'Something went wrong. Please try again.'));
      }
    }
    deps.log.info('request', { method: req.method, path: req.path, status: response.statusCode, ms: Date.now() - started });
    return response;
  };
}
