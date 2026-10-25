import { useRef, useState, type DragEvent } from 'react';
import { fileExtension, type EffectiveLimits } from '@sendless/shared';
import { bytes } from '../format.js';
import { useI18n, type Translate } from '../i18n/index.js';
import { FileIcon, PlusIcon, UploadIcon, XIcon } from './icons.js';
import { Button, cx } from './ui.js';

/** Client-side checks that mirror the server's limits, for quick feedback. */
export function validateFiles(
  files: File[],
  limits: Pick<EffectiveLimits, 'maxFilesPerTransfer' | 'blockedExtensions'>,
  maxBytes: number,
  t: Translate,
  locale: string,
): string | null {
  if (files.length > limits.maxFilesPerTransfer) return t('send.tooMany', { count: limits.maxFilesPerTransfer });
  const empty = files.find((f) => f.size === 0);
  if (empty) return t('send.emptyFile', { name: empty.name });
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > maxBytes) return t('send.tooLarge', { size: bytes(maxBytes, locale) });
  const blocked = files.find((f) => limits.blockedExtensions.includes(fileExtension(f.name)));
  if (blocked) return t('send.blocked', { ext: fileExtension(blocked.name) });
  return null;
}

function dedupe(existing: File[], added: File[]): File[] {
  const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
  const seen = new Set(existing.map(key));
  return [...existing, ...added.filter((f) => !seen.has(key(f)))];
}

export function FilePicker({ files, onChange, disabled }: { files: File[]; onChange(files: File[]): void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const total = files.reduce((sum, f) => sum + f.size, 0);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    onChange(dedupe(files, [...e.dataTransfer.files]));
  };

  return (
    <div className="file-picker">
      <div
        className={cx('dropzone', dragging && 'dropzone-active', files.length > 0 && 'dropzone-compact')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadIcon size={files.length ? 20 : 36} />
        <p>
          {t('send.drop')} {t('send.dropHint')}{' '}
          <button type="button" className="link-button" onClick={() => input.current?.click()} disabled={disabled}>
            {files.length ? t('send.addMore').toLowerCase() : t('send.choose')}
          </button>
        </p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onChange(dedupe(files, [...(e.target.files ?? [])]));
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <>
          <ul className="file-list">
            {files.map((file, i) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                <FileIcon />
                <span className="file-name" title={file.name}>
                  {file.name}
                </span>
                <span className="muted">{bytes(file.size, locale)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<XIcon />}
                  aria-label={t('send.remove', { name: file.name })}
                  disabled={disabled}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                />
              </li>
            ))}
          </ul>
          <div className="file-total">
            <span className="muted">{t('send.total', { count: files.length, size: bytes(total, locale) })}</span>
            <Button size="sm" variant="ghost" icon={<PlusIcon />} disabled={disabled} onClick={() => input.current?.click()}>
              {t('send.addMore')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
