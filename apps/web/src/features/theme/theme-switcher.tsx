import { Contrast, Moon, SegmentedControl, Sun, SunMoon, type LucideIcon } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useDeviceStore } from '../../stores/device-store';
import { effectiveTheme, useThemeStore, type ThemePreference } from './theme-store';

const OPTIONS = [
  { value: 'system', icon: SunMoon, labelKey: 'theme.system' },
  { value: 'light', icon: Sun, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { value: 'high-contrast', icon: Contrast, labelKey: 'theme.highContrast' },
] as const satisfies readonly { value: ThemePreference; icon: LucideIcon; labelKey: string }[];

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const kind = useDeviceStore((s) => s.kind);

  return (
    <SegmentedControl
      aria-label={t('theme.label')}
      value={effectiveTheme(preference, kind)}
      onValueChange={setPreference}
      options={OPTIONS.map(({ value, icon: Icon, labelKey }) => ({
        value,
        label: <Icon aria-hidden="true" />,
        ariaLabel: t(labelKey),
      }))}
    />
  );
}
