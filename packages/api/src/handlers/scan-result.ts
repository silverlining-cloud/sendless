import { handleScanResult, type ScanResultEvent } from '@s3ndless/ee/api';
import { awsDeps } from '../runtime.js';

/** Pro: receives GuardDuty Malware Protection scan results from EventBridge. */
export async function handler(event: ScanResultEvent) {
  await handleScanResult(awsDeps(), event);
}
