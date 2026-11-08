import { cn, Contrast, Moon, SegmentedControl, Sun, SunMoon, type LucideIcon } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useDeviceStore } from '../../stores/device-store';
import { effectiveTheme, useThemeStore, type TextSize, type ThemePreference } from './theme-store';

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

/* The three sizes, drawn as an "A" at each size; these sizes are the picture, not text styling. */
const SIZES = [
  { value: 'default', labelKey: 'theme.textSize.default', className: 'text-sm' },
  { value: 'large', labelKey: 'theme.textSize.large', className: 'text-base' },
  { value: 'xlarge', labelKey: 'theme.textSize.xlarge', className: 'text-lg' },
] as const satisfies readonly { value: TextSize; labelKey: string; className: string }[];

/** Text size on this device: default, large or extra large. */
export function TextSizeSwitcher() {
  const { t } = useTranslation();
  const textSize = useThemeStore((s) => s.textSize);
  const setTextSize = useThemeStore((s) => s.setTextSize);

  return (
    <SegmentedControl
      aria-label={t('theme.textSize.label')}
      value={textSize}
      onValueChange={setTextSize}
      options={SIZES.map(({ value, labelKey, className }) => ({
        value,
        label: (
          <span aria-hidden="true" className={cn('font-semibold', className)}>
            A
          </span>
        ),
        ariaLabel: t(labelKey),
      }))}
    />
  );
}
