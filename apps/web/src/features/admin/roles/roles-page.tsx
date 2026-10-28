import { Badge, Button, Card, Lock, Pencil, Plus, Users } from '@restroos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../../api/endpoints';
import { Can } from '../../auth/permissions';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';
import { roleName } from './role-name';

export function RolesPage() {
  const { t } = useTranslation();
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('roles.title')}
        description={t('roles.description')}
        actions={
          <Can permission="roles.manage">
            <Button asChild>
              <Link to="/admin/roles/new">
                <Plus aria-hidden="true" />
                {t('roles.add')}
              </Link>
            </Button>
          </Can>
        }
      />
      <QueryState query={roles}>
        {({ data }) => (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((r) => (
              <li key={r.id}>
                <Card className="flex h-full flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold">{roleName(t, r)}</h2>
                      <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.isLocked && (
                        <Badge variant="warning">
                          <Lock aria-hidden="true" />
                          {t('roles.locked')}
                        </Badge>
                      )}
                      {r.isSystem && !r.isLocked && <Badge>{t('roles.builtIn')}</Badge>}
                    </div>
                  </div>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden="true" className="size-4" />
                      {t('roles.userCount', { count: r.userCount })}
                    </span>
                    <span>{t('roles.permissionCount', { count: r.permissions.length })}</span>
                  </p>
                  <Button asChild variant="outline" className="mt-auto self-start">
                    <Link to={`/admin/roles/${r.id}`}>
                      <Pencil aria-hidden="true" />
                      {r.isLocked ? t('roles.view') : t('roles.editPermissions')}
                    </Link>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
