export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|session|key$/i;

/** JSON-lines logger. Field names that look sensitive are always redacted. */
export function createLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ level, message, ...base, ...redact(fields ?? {}) }, errorReplacer);
    if (level === 'error') console.error(line);
    else console.log(line);
  };
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

function redact(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE.test(key)) out[key] = '[redacted]';
    else if (v && typeof v === 'object' && !(v instanceof Error) && !Array.isArray(v) && depth < 3)
      out[key] = redact(v as Record<string, unknown>, depth + 1);
    else out[key] = v;
  }
  return out;
}

function errorReplacer(_key: string, value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}
