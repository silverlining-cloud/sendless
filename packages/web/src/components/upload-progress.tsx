import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinalizeResult, UploadPlan } from '@s3ndless/shared';
import { bytes, seconds } from '../format.js';
import { useI18n } from '../i18n/index.js';
import { abortUpload, runUpload, UploadCancelled, type UploadProgress } from '../upload/engine.js';
import { Button, Card, ProgressBar } from './ui.js';

type Phase = 'idle' | 'uploading' | 'done';

/** Runs an upload plan and tracks progress; warns before leaving the page mid-upload. */
export function useUpload() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const plan = useRef<UploadPlan | null>(null);

  useEffect(() => {
    if (phase !== 'uploading') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t('send.leaveWarning');
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase, t]);

  const start = useCallback(async (next: UploadPlan, files: File[]): Promise<FinalizeResult | null> => {
    controller.current = new AbortController();
    plan.current = next;
    setPhase('uploading');
    setProgress({ uploaded: 0, total: next.files.reduce((s, f) => s + f.size, 0), bytesPerSecond: 0, secondsLeft: Infinity });
    try {
      const result = await runUpload(next, files, { onProgress: setProgress, signal: controller.current.signal });
      setPhase('done');
      return result;
    } catch (error) {
      setPhase('idle');
      await abortUpload(next);
      if (error instanceof UploadCancelled) return null;
      throw error;
    }
  }, []);

  const cancel = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => {
    setPhase('idle');
    setProgress(null);
  }, []);

  return { phase, progress, start, cancel, reset };
}

export function UploadProgressCard({ progress, onCancel }: { progress: UploadProgress; onCancel(): void }) {
  const { t, locale } = useI18n();
  const ratio = progress.total ? progress.uploaded / progress.total : 0;
  return (
    <Card className="upload-progress">
      <div className="upload-progress-head">
        <h2>{t('send.uploading')}</h2>
        <strong>{Math.floor(ratio * 100)} %</strong>
      </div>
      <ProgressBar value={ratio} label={t('send.uploading')} />
      <div className="upload-progress-meta muted" aria-live="polite">
        <span>
          {bytes(progress.uploaded, locale)} / {bytes(progress.total, locale)}
        </span>
        <span>
          {progress.bytesPerSecond > 0
            ? t('send.speed', { speed: bytes(progress.bytesPerSecond, locale), eta: seconds(progress.secondsLeft, locale) })
            : ''}
        </span>
      </div>
      <div>
        <Button variant="ghost" onClick={onCancel}>
          {t('send.cancelUpload')}
        </Button>
      </div>
    </Card>
  );
}
