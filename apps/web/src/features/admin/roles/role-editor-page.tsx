import type { Permission, Role } from '@restroos/contracts';
import { CreateRoleRequestSchema } from '@restroos/contracts';
import { Alert, ArrowLeft, Button, Field, Input, Spinner } from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { isApiError } from '../../../api/client';
import { api } from '../../../api/endpoints';
import { useErrorMessage } from '../../../lib/errors';
import { fieldErrors } from '../../../lib/form';
import { usePermission } from '../../auth/permissions';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { PermissionMatrix } from './permission-matrix';
import { roleName } from './role-name';

/** /admin/roles/new and /admin/roles/:roleId. */
export function RoleEditorPage() {
  const { t } = useTranslation();
  const { roleId } = useParams();
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: api.roles.permissions });
  const errorMessage = useErrorMessage();

  if (roles.isError || permissions.isError) {
    return (
      <Alert tone="danger" role="alert">
        {errorMessage(roles.error ?? permissions.error)}
      </Alert>
    );
  }
  if (roles.data === undefined || permissions.data === undefined) {
    return <Spinner label={t('common.loading')} />;
  }
  const role = roleId === undefined ? null : roles.data.data.find((r) => r.id === roleId);
  if (role === undefined) return <Alert tone="danger">{t('errors.notFound')}</Alert>;
  return <RoleEditor key={role?.id ?? 'new'} role={role} permissions={permissions.data.data} />;
}

const MESSAGES = { code: 'roles.codeError', name: 'validation.nameLength' } as const;

function RoleEditor({
  role,
  permissions,
}: {
  role: Role | null;
  permissions: readonly Permission[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canManage = usePermission('roles.manage');
  const readOnly = !canManage || role?.isLocked === true;
  const [code, setCode] = useState(role?.code ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role?.permissions ?? []));
  const [errors, setErrors] = useState<
    Partial<Record<keyof typeof MESSAGES, (typeof MESSAGES)[keyof typeof MESSAGES]>>
  >({});

  const save = useMutation({
    mutationFn: async () => {
      // Keep the Hub's permission order, not the click order.
      const chosen = permissions.map((p) => p.code).filter((c) => selected.has(c));
      if (role === null) {
        const parsed = CreateRoleRequestSchema.safeParse({ code, name, permissions: chosen });
        setErrors(fieldErrors(parsed, MESSAGES));
        if (!parsed.success) return null;
        return api.roles.create(parsed.data);
      }
      if (!role.isSystem && (name.trim().length < 2 || name.trim().length > 60)) {
        setErrors({ name: 'validation.nameLength' });
        return null;
      }
      return api.roles.update(role.id, {
        version: role.version,
        ...(role.isSystem ? {} : { name: name.trim() }),
        permissions: chosen,
      });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast(t('roles.saved', { name: roleName(t, saved) }));
      void navigate('/admin/roles');
    },
  });

  const title = role === null ? t('roles.add') : roleName(t, role);
  return (
    <div className="flex flex-col gap-5">
      <Button asChild variant="ghost" className="self-start">
        <Link to="/admin/roles">
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
          {t('roles.backToRoles')}
        </Link>
      </Button>
      <AdminHeader
        title={title}
        description={t('roles.editorDescription', { count: selected.size })}
        actions={
          readOnly ? undefined : (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          )
        }
      />
      {role?.isLocked === true && <Alert tone="info">{t('roles.adminLocked')}</Alert>}
      {save.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(save.error)}
          {isApiError(save.error, 'VERSION_CONFLICT') && (
            <Button
              variant="outline"
              size="sm"
              className="ms-2"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['roles'] })}
            >
              {t('common.reload')}
            </Button>
          )}
        </Alert>
      )}
      {(role === null || !role.isSystem) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('roles.name')} required error={errors.name ? t(errors.name) : undefined}>
            {(p) => (
              <Input
                {...p}
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('roles.code')}
            hint={role === null ? t('roles.codeHint') : t('roles.codeFixed')}
            required={role === null}
            error={errors.code ? t(errors.code) : undefined}
          >
            {(p) => (
              <Input
                {...p}
                value={code}
                disabled={role !== null}
                className="font-mono"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            )}
          </Field>
        </div>
      )}
      <PermissionMatrix
        permissions={permissions}
        selected={selected}
        onChange={setSelected}
        readOnly={readOnly}
      />
    </div>
  );
}
