import type { Deps } from '../ports.js';
import { auditExpiry, recordEvent, requestSubject, SYSTEM } from './audit.js';
import { destroyTransfer } from './transfers.js';

export interface SweepResult {
  transfers: number;
  requests: number;
  errors: number;
}

/**
 * Deletes the files of transfers that expired, ran out of opens or were never finished,
 * and closes expired file requests. Runs on a schedule; S3 lifecycle rules are the backstop.
 */
export async function sweep(deps: Deps, budgetMs = 50_000): Promise<SweepResult> {
  const started = Date.now();
  const result: SweepResult = { transfers: 0, requests: 0, errors: 0 };
  const failed = new Set<string>();

  while (Date.now() - started < budgetMs) {
    const due = (await deps.store.listDue(deps.now(), 100)).filter((d) => !failed.has(`${d.kind}#${d.id}`));
    if (due.length === 0) break;
    for (const item of due) {
      try {
        if (item.kind === 'transfer') {
          if (await destroyTransfer(deps, item.id, 'expired', SYSTEM)) result.transfers++;
        } else if (await deps.store.endRequest(item.id, 'expired', await auditExpiry(deps))) {
          result.requests++;
          await recordEvent(deps, { subject: requestSubject(item.id), action: 'request.expired', actor: SYSTEM });
        }
      } catch (error) {
        result.errors++;
        failed.add(`${item.kind}#${item.id}`);
        deps.log.error('sweep failed', { kind: item.kind, id: item.id, error });
      }
    }
  }
  return result;
}
