import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  type Role,
  type User,
} from '@restroos/contracts';
import { Alert, Button, Checkbox, Dialog, Field, Input, Select } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { api } from '../../../api/endpoints';
import { LOCALE_OPTIONS } from '../../../i18n/config';
import { useErrorMessage } from '../../../lib/errors';
import { fieldErrors } from '../../../lib/form';
import { isWeakPin } from '../../../lib/pin';
import { toast } from '../../toast/toast-store';
import { roleName } from '../roles/role-name';
import { UserActions } from './user-actions';

const MESSAGES = {
  username: 'validation.username',
  fullName: 'validation.nameLength',
  phone: 'validation.phone',
  email: 'validation.email',
  password: 'validation.passwordShort',
  pin: 'validation.pinFormat',
  roleIds: 'validation.chooseOne',
} as const;
type FieldName = keyof typeof MESSAGES;
type ErrorKey = (typeof MESSAGES)[FieldName] | 'validation.pinWeak';

interface Draft {
  username: string;
  fullName: string;
  phone: string;
  email: string;
  preferredLocale: '' | 'en-IN' | 'hi-IN' | 'bn-IN';
  password: string;
  pin: string;
  roleIds: string[];
}

function draftOf(user: User | null): Draft {
  return {
    username: user?.username ?? '',
    fullName: user?.fullName ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    preferredLocale: user?.preferredLocale ?? '',
    password: '',
    pin: '',
    roleIds: user?.roleIds ?? [],
  };
}

/** Create a staff member, or edit one (details, roles and account actions). */
export function UserDialog({
  user,
  roles,
  onClose,
}: {
  /** `null` = create. */
  user: User | null;
  roles: readonly Role[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState(() => draftOf(user));
  const [errors, setErrors] = useState<Partial<Record<FieldName, ErrorKey>>>({});
  const [conflict, setConflict] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const text = (s: string) => (s.trim() === '' ? undefined : s.trim());

  const save = useMutation({
    mutationFn: async () => {
      if (user === null) {
        const body = {
          username: draft.username,
          fullName: draft.fullName,
          password: draft.password,
          roleIds: draft.roleIds,
          ...(text(draft.phone) ? { phone: text(draft.phone) } : {}),
          ...(text(draft.email) ? { email: text(draft.email) } : {}),
          ...(draft.preferredLocale !== '' ? { preferredLocale: draft.preferredLocale } : {}),
          ...(draft.pin !== '' ? { pin: draft.pin } : {}),
        };
        const parsed = CreateUserRequestSchema.safeParse(body);
        const found: Partial<Record<FieldName, ErrorKey>> = fieldErrors(parsed, MESSAGES);
        if (found.pin === undefined && isWeakPin(draft.pin)) found.pin = 'validation.pinWeak';
        setErrors(found);
        if (!parsed.success || Object.keys(found).length > 0) return null;
        return api.users.create(parsed.data);
      }
      const body = {
        version: user.version,
        fullName: draft.fullName,
        phone: text(draft.phone) ?? null,
        email: text(draft.email) ?? null,
        preferredLocale: draft.preferredLocale === '' ? null : draft.preferredLocale,
        roleIds: draft.roleIds,
      };
      const parsed = UpdateUserRequestSchema.safeParse(body);
      const found = fieldErrors(parsed, MESSAGES);
      setErrors(found);
      if (!parsed.success) return null;
      return api.users.update(user.id, parsed.data);
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast(t('users.saved', { name: saved.fullName }));
      onClose();
    },
    onError: (e) => setConflict(isApiError(e, 'VERSION_CONFLICT')),
  });

  const err = (f: FieldName) => (errors[f] === undefined ? undefined : t(errors[f]));
  const assignable = roles.filter((r) => r.code !== 'ADMIN' || user?.roleIds.includes(r.id));

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={user === null ? t('users.add') : t('users.editTitle', { name: user.fullName })}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {save.isError && (
          <Alert tone="danger" role="alert">
            <p>{errorMessage(save.error)}</p>
            {conflict && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ['users'] });
                  onClose();
                }}
              >
                {t('common.reload')}
              </Button>
            )}
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('setup.admin.fullName')} required error={err('fullName')}>
            {(p) => (
              <Input
                {...p}
                value={draft.fullName}
                onChange={(e) => set({ fullName: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('login.username')}
            required={user === null}
            hint={user === null ? t('validation.username') : t('users.usernameFixed')}
            error={err('username')}
          >
            {(p) => (
              <Input
                {...p}
                value={draft.username}
                disabled={user !== null}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => set({ username: e.target.value.toLowerCase() })}
              />
            )}
          </Field>
          <Field label={t('setup.business.phone')} hint={t('common.optional')} error={err('phone')}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                value={draft.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('users.email')} hint={t('common.optional')} error={err('email')}>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={draft.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('users.language')} hint={t('users.languageHint')}>
            {(p) => (
              <Select
                {...p}
                value={draft.preferredLocale}
                onChange={(e) =>
                  set({ preferredLocale: e.target.value as Draft['preferredLocale'] })
                }
              >
                <option value="">{t('users.languageDevice')}</option>
                {LOCALE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code} lang={o.code}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {user === null && (
            <>
              <Field
                label={t('login.password')}
                hint={t('validation.passwordHint')}
                required
                error={err('password')}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={draft.password}
                    onChange={(e) => set({ password: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label={t('setup.admin.pin')}
                hint={t('setup.admin.pinHint')}
                error={err('pin')}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="off"
                    value={draft.pin}
                    onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })}
                  />
                )}
              </Field>
            </>
          )}
        </div>
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium">{t('users.roles')}</legend>
          <div className="grid sm:grid-cols-2">
            {assignable.map((r) => (
              <Checkbox
                key={r.id}
                label={roleName(t, r)}
                checked={draft.roleIds.includes(r.id)}
                onChange={(e) =>
                  set({
                    roleIds: e.target.checked
                      ? [...draft.roleIds, r.id]
                      : draft.roleIds.filter((id) => id !== r.id),
                  })
                }
              />
            ))}
          </div>
          {errors.roleIds !== undefined && (
            <p className="text-sm font-medium text-state-danger-fg">{t(errors.roleIds)}</p>
          )}
        </fieldset>
        {user !== null && <UserActions user={user} onDone={onClose} />}
      </div>
    </Dialog>
  );
}
