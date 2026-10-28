import type { Category } from '@restroos/contracts';
import { Alert, Button, cn, Dialog, Field, Input } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { toast } from '../toast/toast-store';
import { CATEGORY_COLOURS, CategorySwatch } from './category-swatch';
import { cleanTranslations } from './localized-name';
import { invalidateMenu } from './menu-queries';

/** Create or edit a category: names in three languages and the order-pad colour. */
export function CategoryDialog({
  category,
  nextSortOrder,
  onClose,
}: {
  category: Category | null;
  /** Where a new category goes: after the last one. */
  nextSortOrder: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(category?.name ?? '');
  const [hi, setHi] = useState(category?.nameTranslations.hi ?? '');
  const [bn, setBn] = useState(category?.nameTranslations.bn ?? '');
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const [nameError, setNameError] = useState(false);

  const save = useMutation({
    mutationFn: async (change: 'save' | 'retire' | 'restore') => {
      if (category !== null && change !== 'save') {
        return api.menu.updateCategory(category.id, {
          version: category.version,
          isActive: change === 'restore',
        });
      }
      if (name.trim().length < 1 || name.trim().length > 120) {
        setNameError(true);
        return null;
      }
      setNameError(false);
      const body = {
        name: name.trim(),
        nameTranslations: cleanTranslations(hi, bn),
        color: color === null ? null : color.toUpperCase(),
      };
      return category === null
        ? api.menu.createCategory({ ...body, sortOrder: nextSortOrder })
        : api.menu.updateCategory(category.id, { ...body, version: category.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void invalidateMenu(queryClient);
      toast(t('menu.categories.saved', { name: saved.name }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={
        category === null
          ? t('menu.categories.add')
          : t('menu.categories.editNamed', { name: category.name })
      }
      footer={
        <>
          {category !== null && (
            <Button
              variant={category.isActive ? 'destructive' : 'secondary'}
              className="me-auto"
              disabled={save.isPending}
              onClick={() => save.mutate(category.isActive ? 'retire' : 'restore')}
            >
              {category.isActive ? t('common.retire') : t('common.restore')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate('save')} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
            {isApiError(save.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
          </Alert>
        )}
        {category !== null && category.isActive && (
          <p className="text-sm text-muted-foreground">{t('menu.categories.retireHint')}</p>
        )}
        <Field
          label={t('menu.fields.nameEn')}
          required
          error={nameError ? t('menu.item.errors.name') : undefined}
        >
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('menu.fields.nameHi')} hint={t('common.optional')}>
            {(p) => <Input {...p} lang="hi" value={hi} onChange={(e) => setHi(e.target.value)} />}
          </Field>
          <Field label={t('menu.fields.nameBn')} hint={t('common.optional')}>
            {(p) => <Input {...p} lang="bn" value={bn} onChange={(e) => setBn(e.target.value)} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('menu.categories.colour')}</legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            <ColourChoice
              label={t('common.none')}
              selected={color === null}
              onSelect={() => setColor(null)}
              color={null}
            />
            {CATEGORY_COLOURS.map((c) => (
              <ColourChoice
                key={c}
                label={c}
                color={c}
                selected={color?.toUpperCase() === c}
                onSelect={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

function ColourChoice({
  label,
  color,
  selected,
  onSelect,
}: {
  label: string;
  color: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        'grid size-touch place-items-center rounded-lg border',
        selected ? 'border-primary ring-2 ring-primary' : 'border-input',
      )}
    >
      <CategorySwatch color={color} className="size-7" />
    </button>
  );
}
