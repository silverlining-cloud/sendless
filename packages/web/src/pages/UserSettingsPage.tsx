import { useId, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { setColorScheme, storedColorScheme, type ColorScheme } from '../color-scheme.js';
import { MonitorIcon, MoonIcon, SunIcon } from '../components/icons.js';
import { Card, PageHeader } from '../components/ui.js';
import { useI18n, type Locale, type MessageKey } from '../i18n/index.js';

const SCHEMES: { value: ColorScheme; label: MessageKey; Icon: typeof SunIcon }[] = [
  { value: 'light', label: 'settings.themeLight', Icon: SunIcon },
  { value: 'system', label: 'settings.themeSystem', Icon: MonitorIcon },
  { value: 'dark', label: 'settings.themeDark', Icon: MoonIcon },
];

/** Language names are written in their own language, so everyone finds theirs. */
const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange(value: T): void }) {
  const labelId = useId();
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="segmented segmented-lg" role="group" aria-labelledby={labelId}>
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? 'active' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Personal settings for every signed-in user. They are kept per browser, like before in the footer. */
export function UserSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { me } = useAuth();
  const [scheme, setScheme] = useState(storedColorScheme);
  return (
    <div className="stack">
      <PageHeader title={t('settings.title')} subtitle={me && t('settings.signedInAs', { email: me.email })} />
      <Card title={t('settings.appearance')}>
        <Choice
          label={t('settings.theme')}
          value={scheme}
          options={SCHEMES.map(({ value, label, Icon }) => ({
            value,
            label: (
              <>
                <Icon size={16} /> {t(label)}
              </>
            ),
          }))}
          onChange={(next) => {
            setColorScheme(next);
            setScheme(next);
          }}
        />
        <Choice label={t('settings.language')} value={locale} options={LANGUAGES} onChange={setLocale} />
        <p className="hint">{t('settings.savedInBrowser')}</p>
      </Card>
    </div>
  );
}
