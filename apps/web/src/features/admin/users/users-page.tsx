import type { Role, User } from '@restroos/contracts';
import {
  Badge,
  Button,
  Lock,
  Pencil,
  SegmentedControl,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  UserPlus,
} from '@restroos/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';
import { roleName } from '../roles/role-name';
import { UserDialog } from './user-dialog';
import { isLocked } from './user-status';

type Filter = 'active' | 'inactive' | 'all';

export function UsersPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const roleList: readonly Role[] = roles.data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <Button onClick={() => setEditing('new')} disabled={roles.data === undefined}>
            <UserPlus aria-hidden="true" />
            {t('users.add')}
          </Button>
        }
      />
      <SegmentedControl<Filter>
        aria-label={t('users.filter')}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'active', label: t('common.active') },
          { value: 'inactive', label: t('common.inactive') },
          { value: 'all', label: t('users.all') },
        ]}
      />
      <QueryState query={users}>
        {({ data }) => {
          const shown = data.filter((u) =>
            filter === 'all' ? true : filter === 'active' ? u.isActive : !u.isActive,
          );
          if (shown.length === 0)
            return <p className="text-muted-foreground">{t('users.empty')}</p>;
          return (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('users.name')}</Th>
                  <Th>{t('users.roles')}</Th>
                  <Th>{t('users.status')}</Th>
                  <Th>{t('users.lastLogin')}</Th>
                  <Th>
                    <span className="sr-only">{t('users.actions')}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <p className="font-medium">{u.fullName}</p>
                      <p className="text-muted-foreground">{u.username}</p>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {u.roleIds.map((id) => {
                          const role = roleList.find((r) => r.id === id);
                          return (
                            <Badge key={id} variant="outline">
                              {role === undefined ? id.slice(0, 8) : roleName(t, role)}
                            </Badge>
                          );
                        })}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={u.isActive ? 'success' : 'neutral'}>
                          {u.isActive ? t('common.active') : t('common.inactive')}
                        </Badge>
                        {isLocked(u) && (
                          <Badge variant="danger">
                            <Lock aria-hidden="true" />
                            {t('users.locked')}
                          </Badge>
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {u.lastLoginAt === null ? t('users.never') : format.dateTime(u.lastLoginAt)}
                    </Td>
                    <Td className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-touch"
                        onClick={() => setEditing(u)}
                        aria-label={t('users.editTitle', { name: u.fullName })}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          );
        }}
      </QueryState>
      {editing !== null && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          roles={roleList}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
