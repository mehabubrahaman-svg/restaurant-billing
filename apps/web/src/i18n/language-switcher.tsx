import { SegmentedControl } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { LOCALE_OPTIONS, PSEUDO_OPTION } from './config';

const OPTIONS = import.meta.env.DEV ? [...LOCALE_OPTIONS, PSEUDO_OPTION] : LOCALE_OPTIONS;

/** `EN | हि | বা`. Each label is shown in its own script and announced in its own language. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <SegmentedControl
      aria-label={t('language.label')}
      value={i18n.language}
      onValueChange={(code) => void i18n.changeLanguage(code)}
      options={OPTIONS.map((o) => ({
        value: o.code,
        label: o.short,
        ariaLabel: o.name,
        lang: o.code,
      }))}
      {...(className === undefined ? {} : { className })}
    />
  );
}
