import { Alert, Button, ImageOff, ImagePlus, Spinner, Trash } from '@restroos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PHOTO_ACCEPT, PhotoError, photoUrl } from '../../lib/dish-photos';
import { useErrorMessage } from '../../lib/errors';
import { uploadDishPhoto } from './photo-upload';

/**
 * The dish photo on the item editor: pick (or drop) one, see it, replace or
 * remove it. It is prepared and uploaded straight away; the item points at
 * it when the item is saved.
 */
export function PhotoField({
  imageId,
  name,
  onChange,
}: {
  /** '' = no photo. */
  imageId: string;
  name: string;
  onChange: (imageId: string) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const input = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => () => void (local && URL.revokeObjectURL(local)), [local]);

  async function take(file: File | undefined) {
    if (file === undefined) return;
    setProblem(null);
    setBusy(true);
    const preview = URL.createObjectURL(file);
    setLocal(preview);
    try {
      onChange(await uploadDishPhoto(file));
    } catch (error) {
      setLocal(null);
      setProblem(
        error instanceof PhotoError
          ? t(`menu.import.photoProblems.${error.problem}`, { name: file.name })
          : errorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  const src = local ?? (imageId === '' ? null : photoUrl(imageId, 'full'));
  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void take(e.dataTransfer.files[0]);
      }}
    >
      <div className="relative grid aspect-square w-40 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted">
        {src === null ? (
          <ImageOff aria-hidden="true" className="size-8 text-muted-foreground" />
        ) : (
          <img
            src={src}
            alt={t('menu.import.photoOf', { name: name || t('menu.item.previewUnnamed') })}
            className="size-full object-cover"
          />
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-background/70">
            <Spinner label={t('menu.item.photoUploading')} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('menu.item.photoHint')}</p>
        <input
          ref={input}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void take(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            <ImagePlus aria-hidden="true" />
            {imageId === '' ? t('menu.item.photoAdd') : t('menu.item.photoReplace')}
          </Button>
          {imageId !== '' && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setLocal(null);
                onChange('');
              }}
            >
              <Trash aria-hidden="true" />
              {t('menu.item.photoRemove')}
            </Button>
          )}
        </div>
        {problem !== null && (
          <Alert tone="danger" role="alert">
            {problem}
          </Alert>
        )}
      </div>
    </div>
  );
}
