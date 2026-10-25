import { awsDeps } from '../runtime.js';
import { sweep } from '../services/sweeper.js';

/** Scheduled every 15 minutes by EventBridge. */
export async function handler() {
  const deps = awsDeps();
  const result = await sweep(deps, 240_000);
  deps.log.info('sweep finished', { ...result });
  return result;
}
