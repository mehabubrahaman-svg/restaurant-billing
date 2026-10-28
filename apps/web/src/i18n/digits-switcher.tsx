import { SegmentedControl } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { usePreferencesStore } from '../stores/preferences-store';
import { hasNativeDigits, type DigitStyle } from './config';
import { refreshMessageFormats } from './index';

/** Latin vs native digits; only offered for languages that have their own digits. */
export function DigitsSwitcher() {
  const { t, i18n } = useTranslation();
  const digits = usePreferencesStore((s) => s.digits);
  const setDigits = usePreferencesStore((s) => s.setDigits);
  if (!hasNativeDigits(i18n.language)) return null;

  const change = (value: DigitStyle) => {
    setDigits(value);
    refreshMessageFormats();
  };
  return (
    <>
      <p className="text-sm font-medium">{t('digits.label')}</p>
      <SegmentedControl<DigitStyle>
        aria-label={t('digits.label')}
        value={digits}
        onValueChange={change}
        options={[
          { value: 'latin', label: t('digits.latin') },
          { value: 'native', label: t('digits.native') },
        ]}
      />
    </>
  );
}
