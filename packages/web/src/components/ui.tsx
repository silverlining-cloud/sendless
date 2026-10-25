import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '../api/client.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { AlertIcon, CheckIcon, CopyIcon } from './icons.js';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  busy?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Spinner small /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Spinner({ small, label }: { small?: boolean; label?: string }) {
  return <span className={cx('spinner', small && 'spinner-sm')} role="status" aria-label={label ?? 'Loading'} />;
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const t = useT();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', error && 'field-error')}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="muted"> ({t('common.optional')})</span>}
      </label>
      {children(id, describedBy)}
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="error-text" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...props} />;
export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input" rows={3} {...props} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select className="input" {...props} />;

export function Checkbox({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...props} />
      <span>
        {label}
        {hint && <span className="hint block">{hint}</span>}
      </span>
    </label>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'; children: ReactNode }) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>;
}

export function StatusBadge({ status }: { status: 'uploading' | 'ready' | 'active' | 'expired' | 'revoked' }) {
  const t = useT();
  const tone = status === 'ready' || status === 'active' ? 'success' : status === 'uploading' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{t(`status.${status}` as MessageKey)}</Badge>;
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'error' | 'success' | 'warning'; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cx('alert', `alert-${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <CheckIcon /> : <AlertIcon />}
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <Alert tone="error" title={t('app.error')}>{message}</Alert>;
}

export function EmptyState({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <p>{children}</p>
      {action}
    </div>
  );
}

export function useCopy(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }, []);
  return [copied, copy];
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [copied, copy] = useCopy();
  return (
    <div className="copy-field">
      <input className="input mono" value={value} readOnly aria-label={label ?? t('transfers.link')} onFocus={(e) => e.currentTarget.select()} />
      <Button variant="primary" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={() => void copy(value)}>
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [copied, copy] = useCopy();
  return (
    <Button size="sm" variant="ghost" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={() => void copy(value)}>
      {copied ? t('common.copied') : (label ?? t('common.copyLink'))}
    </Button>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Two-step delete: first click asks, second confirms. */
export function ConfirmButton({ children, confirmText, onConfirm, icon }: { children: ReactNode; confirmText: string; onConfirm: () => Promise<void> | void; icon?: ReactNode }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <Button variant="danger" size="sm" icon={icon} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <div className="confirm">
      <span>{confirmText}</span>
      <Button
        variant="danger"
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {t('common.yes')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload(): void;
  setData(value: T): void;
}

/** Loads data on mount and whenever `deps` change. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then(
      (data) => active && setState({ data, loading: false }),
      (error) => active && setState({ error, loading: false }),
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload: () => setTick((n) => n + 1),
    setData: (data: T) => setState({ data, loading: false }),
  };
}

export function Loading() {
  const t = useT();
  return (
    <div className="loading">
      <Spinner label={t('app.loading')} />
    </div>
  );
}

/** Shows content, a spinner or an error for an AsyncState. */
export function AsyncView<T>({ state, children }: { state: AsyncState<T>; children: (data: T) => ReactNode }) {
  const t = useT();
  if (state.loading && state.data === undefined) return <Loading />;
  if (state.error) {
    return (
      <div className="stack">
        <ErrorAlert error={state.error} />
        <div>
          <Button onClick={state.reload}>{t('app.retry')}</Button>
        </div>
      </div>
    );
  }
  return <>{state.data !== undefined && children(state.data)}</>;
}

export function isApiError(error: unknown, ...codes: string[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.includes(error.code));
}

export function ProGate({ licensed, children }: { licensed: boolean; children: ReactNode }) {
  const t = useT();
  if (licensed) return <>{children}</>;
  return (
    <Card>
      <div className="pro-gate">
        <Badge tone="brand">{t('common.proFeature')}</Badge>
        <h2>{t('admin.proRequired')}</h2>
        <p className="muted">{t('admin.proRequiredText')}</p>
        <a className="btn btn-primary" href="/admin/license">
          {t('admin.license')}
        </a>
      </div>
    </Card>
  );
}
