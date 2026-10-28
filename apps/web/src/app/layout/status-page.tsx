import { Button, Card, CardContent, CardHeader, type LucideIcon } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHomePath } from '../use-home-path';

/** "No access" / "not found" card with a way back home. */
export function StatusPage({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  const { t } = useTranslation();
  const home = useHomePath();
  return (
    <Card className="mx-auto mt-8 max-w-lg">
      <title>{title}</title>
      <CardHeader className="flex-row items-center gap-3">
        <Icon aria-hidden="true" className="size-6 shrink-0 text-state-danger-fg" />
        <h1 className="text-lg leading-snug font-semibold">{title}</h1>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">{body}</p>
        <Button asChild variant="outline">
          <Link to={home}>{t('access.goHome')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
