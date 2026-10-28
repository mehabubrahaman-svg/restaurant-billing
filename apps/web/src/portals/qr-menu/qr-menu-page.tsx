import { Card, CardContent, QrCode } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { LanguageSwitcher } from '../../i18n/language-switcher';

/** Guest self-ordering (public, phone-first). No staff shell, no sign-in. */
export function QrMenuPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <title>{t('portals.qrMenu.title')}</title>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-lg font-bold">
          <QrCode aria-hidden="true" className="size-6 text-primary" />
          {t('portals.qrMenu.title')}
        </span>
        <LanguageSwitcher />
      </header>
      <Card>
        <CardContent className="pt-5">
          <p>{t('portals.qrMenu.description', { token })}</p>
          <p className="mt-3 text-sm text-muted-foreground">{t('placeholder.body')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
