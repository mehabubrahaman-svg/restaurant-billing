import { Badge, Card, CardContent } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Portal } from '../app/portals';

/** Title + description for portals that are not built yet. */
export function PortalPlaceholder({ portal, children }: { portal: Portal; children?: ReactNode }) {
  const { t } = useTranslation();
  const Icon = portal.icon;
  const title = t(portal.titleKey);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <title>{`${title} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold">{title}</h1>
            <Badge variant="warning">{t('placeholder.badge')}</Badge>
          </div>
          <p className="text-muted-foreground">{t(portal.descriptionKey)}</p>
        </div>
      </header>
      <Card>
        <CardContent className="pt-5 text-sm text-muted-foreground">
          {t('placeholder.body')}
        </CardContent>
      </Card>
      {children}
    </div>
  );
}
