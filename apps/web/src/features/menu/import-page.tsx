import type { MenuImportResponse } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  CircleCheck,
  Download,
  FileSpreadsheet,
  Field,
  ImagePlus,
  Images,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  Trash,
  Upload,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/endpoints';
import { useFormat } from '../../i18n/use-format';
import { mapLimit, PhotoError } from '../../lib/dish-photos';
import { saveBlob } from '../../lib/download';
import { useErrorMessage } from '../../lib/errors';
import { AdminHeader } from '../admin/admin-layout';
import { menuCsvTemplate } from './csv-template';
import { invalidateMenu, MENU_KEYS } from './menu-queries';
import {
  MENU_COLUMNS,
  menuExport,
  menuTemplate,
  parseCsv,
  readMenuFile,
  SheetError,
  type MenuLookups,
  type MenuSheet,
} from './menu-workbook';
import { collectPhotos, type PickedPhoto, type SkippedFile } from './photo-files';
import { uploadDishPhoto } from './photo-upload';

const MAX_CSV_CHARS = 2_000_000;
/** The preview lists at most this many rows; the counts above it cover them all. */
const PREVIEW_ROWS = 500;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET_ACCEPT = `.xlsx,.csv,text/csv,${XLSX}`;
const PHOTO_PICK_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.zip';

interface Photo extends PickedPhoto {
  /** Media id once uploaded. */
  id?: string;
  /** Why it couldn't be prepared or uploaded. */
  problem?: string;
  readonly preview: string;
}

/**
 * Admin → Menu → Upload: an Excel workbook or CSV of dishes, plus their
 * photos (files or a .zip). The photos are shrunk on this device and
 * uploaded, then the Hub checks every row (a dry run) and shows what will
 * change. Nothing is saved until the person presses Import, and nothing at
 * all if any row is wrong.
 */
export function ImportPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const sheetInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const [sheet, setSheet] = useState<MenuSheet | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [retireMissing, setRetireMissing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Bumped by every change to what would be imported: an old check no longer counts. */
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState<{ revision: number; result: MenuImportResponse } | null>(
    null,
  );
  const [imported, setImported] = useState<MenuImportResponse | null>(null);
  const changed = () => {
    setRevision((r) => r + 1);
    setImported(null);
  };

  // Photo previews are object URLs: let them go with the page.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const lookups = useLookups();

  // ---- the spreadsheet ---------------------------------------------------------
  async function takeSheet(file: File) {
    setSheetError(null);
    try {
      const read = await readMenuFile(file);
      setSheet(read);
      setCsv('');
    } catch (error) {
      setSheet(null);
      setSheetError(
        t(
          `menu.import.sheetErrors.${(error instanceof SheetError ? error.message : 'unreadable') as 'unreadable'}`,
        ),
      );
    }
    changed();
  }

  function takePastedCsv(text: string) {
    setCsv(text);
    setSheet(text.trim() === '' ? null : { fileName: '', sheetName: null, rows: parseCsv(text) });
    setSheetError(null);
    changed();
  }

  // ---- photos ------------------------------------------------------------------
  async function addPhotos(files: readonly File[]) {
    const { photos: picked, skipped: more } = await collectPhotos(files, photos);
    setPhotos((current) => [
      ...current,
      ...picked.map((p) => ({ ...p, preview: URL.createObjectURL(p.file) })),
    ]);
    setSkipped((s) => [...s, ...more]);
    changed();
  }

  function clearPhotos() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setSkipped([]);
    changed();
  }

  /** Prepares and uploads the photos not on the Hub yet; returns file name → media id. */
  async function uploadPhotos(): Promise<Record<string, string>> {
    const todo = photos.filter((p) => p.id === undefined && p.problem === undefined);
    const results = new Map<string, Pick<Photo, 'id' | 'problem'>>();
    if (todo.length > 0) {
      setProgress({ done: 0, total: todo.length });
      let done = 0;
      await mapLimit(todo, 3, async (photo) => {
        try {
          results.set(photo.name, { id: await uploadDishPhoto(photo.file) });
        } catch (error) {
          results.set(photo.name, {
            problem:
              error instanceof PhotoError
                ? t(`menu.import.photoProblems.${error.problem}`, { name: photo.name })
                : t('menu.import.photoProblems.upload', {
                    name: photo.name,
                    reason: errorMessage(error),
                  }),
          });
        }
        setProgress({ done: ++done, total: todo.length });
      });
      setProgress(null);
    }
    const next = photos.map((p) => ({ ...p, ...results.get(p.name) }));
    setPhotos(next);
    return Object.fromEntries(
      next.filter((p) => p.id !== undefined).map((p) => [p.name, p.id!] as const),
    );
  }

  // ---- check and import -------------------------------------------------------------
  const send = async (dryRun: boolean) =>
    api.menu.importRows({
      rows: sheet!.rows,
      images: await uploadPhotos(),
      retireMissing,
      dryRun,
    });
  const check = useMutation({
    mutationFn: async (at: number) => ({ revision: at, result: await send(true) }),
    onSuccess: (r) => {
      setChecked(r);
      setImported(null);
    },
  });
  const run = useMutation({
    mutationFn: () => send(false),
    onSuccess: (result) => {
      setImported(result);
      setChecked(null);
      void invalidateMenu(queryClient);
    },
  });

  // ---- downloads -----------------------------------------------------------------
  function downloadTemplate() {
    const bytes = menuTemplate(lookups, {
      title: t('menu.import.instructionsSheet'),
      required: t('menu.import.required'),
      optional: t('menu.import.optional'),
      rows: MENU_COLUMNS.map((column) => ({
        column,
        text: t(`menu.import.columns.${column}`),
      })),
    });
    void saveBlob(
      new Blob([Uint8Array.from(bytes)], { type: XLSX }),
      'restroos-menu-template.xlsx',
    );
  }
  function downloadCsvTemplate() {
    void saveBlob(
      new Blob([`\uFEFF${menuCsvTemplate()}`], { type: 'text/csv;charset=utf-8' }),
      'restroos-menu-template.csv',
    );
  }
  const exportMenu = useMutation({
    mutationFn: async () => {
      const items = await api.menu.items();
      const bytes = menuExport(items.data, lookups);
      await saveBlob(new Blob([Uint8Array.from(bytes)], { type: XLSX }), 'restroos-menu.xlsx');
    },
  });

  const current = checked !== null && checked.revision === revision ? checked.result : null;
  const canImport = current !== null && current.errors.length === 0 && current.rows > 0;
  const busy = check.isPending || run.isPending;
  const photoProblems = photos.filter((p) => p.problem !== undefined);
  const n = (v: number) => format.number(v);
  const onDrop = (take: (files: File[]) => void) => (e: DragEvent) => {
    e.preventDefault();
    take(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('menu.import.title')}
        description={t('menu.import.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download aria-hidden="true" />
              {t('menu.import.template')}
            </Button>
            <Button
              variant="outline"
              onClick={() => exportMenu.mutate()}
              disabled={exportMenu.isPending}
            >
              <FileSpreadsheet aria-hidden="true" />
              {t('menu.import.export')}
            </Button>
          </div>
        }
      />
      {exportMenu.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(exportMenu.error)}
        </Alert>
      )}

      {/* 1. The spreadsheet */}
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-lg font-semibold">{t('menu.import.step1')}</h2>
        <div
          className="flex flex-col items-start gap-3 rounded-xl border-2 border-dashed p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop((files) => files[0] && void takeSheet(files[0]))}
        >
          <p className="text-sm text-muted-foreground">{t('menu.import.dropSheet')}</p>
          <input
            ref={sheetInput}
            type="file"
            accept={SHEET_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void takeSheet(file);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" onClick={() => sheetInput.current?.click()}>
            <Upload aria-hidden="true" />
            {t('menu.import.upload')}
          </Button>
          {sheet !== null && sheet.fileName !== '' && (
            <p className="text-sm break-all" role="status">
              {t('menu.import.fileChosen', { name: sheet.fileName })}
              {' · '}
              {sheet.sheetName === null
                ? t('menu.import.csvRows', { count: Math.max(0, sheet.rows.length - 1) })
                : t('menu.import.sheetUsed', {
                    sheet: sheet.sheetName,
                    count: Math.max(0, sheet.rows.length - 1),
                  })}
            </p>
          )}
          {sheetError !== null && (
            <Alert tone="danger" role="alert">
              {sheetError}
            </Alert>
          )}
        </div>
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('menu.import.pasteTitle')}</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field
              label={t('menu.import.paste')}
              hint={t('menu.import.pasteHint')}
              error={csv.length > MAX_CSV_CHARS ? t('menu.import.tooBig') : undefined}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={6}
                  spellCheck={false}
                  className="font-mono text-sm"
                  value={csv}
                  onChange={(e) => takePastedCsv(e.target.value)}
                />
              )}
            </Field>
            <Button variant="ghost" size="sm" className="self-start" onClick={downloadCsvTemplate}>
              <Download aria-hidden="true" />
              {t('menu.import.templateCsv')}
            </Button>
          </div>
        </details>
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('menu.import.columnsTitle')}</summary>
          <p className="mt-2 text-muted-foreground">{t('menu.import.columnsNote')}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {MENU_COLUMNS.map((column) => (
              <li key={column}>
                <code className="font-mono font-semibold">{column}</code>
                {' — '}
                {t(`menu.import.columns.${column}`)}
              </li>
            ))}
          </ul>
        </details>
      </Card>

      {/* 2. Photos */}
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-lg font-semibold">{t('menu.import.photosStep')}</h2>
        <div
          className="flex flex-col items-start gap-3 rounded-xl border-2 border-dashed p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop((files) => void addPhotos(files))}
        >
          <p className="text-sm text-muted-foreground">{t('menu.import.photosHint')}</p>
          <input
            ref={photoInput}
            type="file"
            multiple
            accept={PHOTO_PICK_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void addPhotos(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => photoInput.current?.click()}>
              <ImagePlus aria-hidden="true" />
              {t('menu.import.addPhotos')}
            </Button>
            {photos.length > 0 && (
              <Button variant="ghost" onClick={clearPhotos} disabled={busy}>
                <Trash aria-hidden="true" />
                {t('menu.import.clearPhotos')}
              </Button>
            )}
          </div>
          {photos.length > 0 && (
            <p className="flex items-center gap-2 text-sm" role="status">
              <Images aria-hidden="true" className="size-4" />
              {t('menu.import.photoCount', { count: photos.length })}
            </p>
          )}
          {photos.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={t('menu.import.photoList')}>
              {photos.slice(0, 60).map((p) => (
                <li key={p.name}>
                  <img
                    src={p.preview}
                    alt={p.name}
                    title={p.name}
                    className={`size-14 rounded-lg object-cover ${p.problem ? 'opacity-40 ring-2 ring-state-danger' : ''}`}
                  />
                </li>
              ))}
            </ul>
          )}
          {(skipped.length > 0 || photoProblems.length > 0) && (
            <Alert tone="warning" title={t('menu.import.photosSkipped')}>
              <ul className="list-disc ps-5">
                {skipped.map((s) => (
                  <li key={`${s.reason}:${s.name}`}>
                    {t(`menu.import.skipped.${s.reason}`, { name: s.name })}
                  </li>
                ))}
                {photoProblems.map((p) => (
                  <li key={p.name}>{p.problem}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      </Card>

      {/* 3. Check */}
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-lg font-semibold">{t('menu.import.step2')}</h2>
        <Checkbox
          label={t('menu.import.retireMissing')}
          description={t('menu.import.retireMissingHint')}
          checked={retireMissing}
          onChange={(e) => {
            setRetireMissing(e.target.checked);
            changed();
          }}
        />
        <Button
          className="self-start"
          disabled={sheet === null || csv.length > MAX_CSV_CHARS || busy}
          onClick={() => check.mutate(revision)}
        >
          {check.isPending ? t('menu.import.checking') : t('menu.import.check')}
        </Button>
        {progress !== null && (
          <div className="flex flex-col gap-1" role="status">
            <span className="text-sm">
              {t('menu.import.preparing', { done: n(progress.done), total: n(progress.total) })}
            </span>
            <progress
              className="h-2 w-full max-w-md accent-primary"
              max={progress.total}
              value={progress.done}
              aria-label={t('menu.import.preparingLabel')}
            />
          </div>
        )}
        {check.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(check.error)}
          </Alert>
        )}

        {current !== null && (
          <div className="flex flex-col gap-4" aria-live="polite">
            <ImportSummary result={current} />
            {current.errors.length > 0 ? (
              <>
                <Alert
                  tone="danger"
                  title={t('menu.import.hasErrors', { count: current.errors.length })}
                >
                  {t('menu.import.fixAndRecheck')}
                </Alert>
                <IssueTable label={t('menu.import.errorsTable')} issues={current.errors} danger />
              </>
            ) : (
              <Alert tone="success">{t('menu.import.noErrors')}</Alert>
            )}
            {current.warnings.length > 0 && (
              <Alert tone="warning" title={t('menu.import.warningsTitle')}>
                <ul className="list-disc ps-5">
                  {current.warnings.map((w, i) => (
                    <li key={i} lang="en">
                      {w.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {current.errors.length === 0 && <Preview result={current} photos={photos} />}
            {run.isError && (
              <Alert tone="danger" role="alert">
                {errorMessage(run.error)}
              </Alert>
            )}
            <Button
              className="self-start"
              disabled={!canImport || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? t('menu.import.importing')
                : t('menu.import.import', { count: current.created + current.updated })}
            </Button>
          </div>
        )}
      </Card>

      {imported !== null && (
        <Alert tone="success" role="status" title={t('menu.import.done')}>
          <ImportSummary result={imported} />
          <Link to="/admin/menu" className="mt-2 inline-block font-medium underline">
            {t('menu.backToMenu')}
          </Link>
        </Alert>
      )}
    </div>
  );
}

/** Categories, stations, tax groups and add-on groups: for the template's lists and the export. */
function useLookups(): MenuLookups {
  const categories = useQuery({ queryKey: MENU_KEYS.categories, queryFn: api.menu.categories });
  const stations = useQuery({ queryKey: MENU_KEYS.stations, queryFn: api.menu.stations });
  const addonGroups = useQuery({ queryKey: MENU_KEYS.addonGroups, queryFn: api.menu.addonGroups });
  const taxGroups = useQuery({ queryKey: ['tax-groups'], queryFn: api.taxGroups.list });
  return useMemo(
    () => ({
      categories: categories.data?.data ?? [],
      stations: stations.data?.data ?? [],
      addonGroups: addonGroups.data?.data ?? [],
      taxGroups: taxGroups.data?.data ?? [],
    }),
    [categories.data, stations.data, addonGroups.data, taxGroups.data],
  );
}

function IssueTable({
  label,
  issues,
  danger,
}: {
  label: string;
  issues: MenuImportResponse['errors'];
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Table aria-label={label}>
      <THead>
        <Tr>
          <Th>{t('menu.import.row')}</Th>
          <Th>{t('menu.import.column')}</Th>
          <Th>{t('menu.import.problem')}</Th>
        </Tr>
      </THead>
      <TBody>
        {issues.map((e, i) => (
          <Tr key={i} className={danger ? 'bg-state-danger-soft' : undefined}>
            <Td className="tabular-nums">{format.number(e.row)}</Td>
            <Td>{e.column === undefined ? '—' : <code className="font-mono">{e.column}</code>}</Td>
            <Td lang="en">{e.message}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

const ACTION_BADGE = { create: 'success', update: 'info', unchanged: 'outline' } as const;

/** Row by row: what happens to each dish, with the photo it gets. */
function Preview({ result, photos }: { result: MenuImportResponse; photos: readonly Photo[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const byName = new Map(photos.map((p) => [p.name, p.preview]));
  const shown = result.items.slice(0, PREVIEW_ROWS);
  return (
    <div className="flex flex-col gap-2">
      <Table aria-label={t('menu.import.previewTable')}>
        <THead>
          <Tr>
            <Th>{t('menu.import.row')}</Th>
            <Th>{t('menu.import.photo')}</Th>
            <Th>{t('menu.import.sku')}</Th>
            <Th>{t('menu.import.name')}</Th>
            <Th>{t('menu.import.change')}</Th>
          </Tr>
        </THead>
        <TBody>
          {shown.map((item) => {
            const preview = item.imageFile !== null ? byName.get(item.imageFile) : undefined;
            return (
              <Tr key={item.row}>
                <Td className="tabular-nums">{format.number(item.row)}</Td>
                <Td>
                  {item.image === 'set' && preview !== undefined ? (
                    <img
                      src={preview}
                      alt={t('menu.import.photoOf', { name: item.name })}
                      className="size-10 rounded-md object-cover"
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t(`menu.import.images.${item.image}`)}
                    </span>
                  )}
                </Td>
                <Td>
                  <code className="font-mono">{item.sku}</code>
                </Td>
                <Td className="break-words">{item.name}</Td>
                <Td>
                  <Badge variant={ACTION_BADGE[item.action]}>
                    {t(`menu.import.actions.${item.action}`)}
                  </Badge>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      {result.items.length > shown.length && (
        <p className="text-sm text-muted-foreground">
          {t('menu.import.previewShown', {
            shown: format.number(shown.length),
            total: format.number(result.items.length),
          })}
        </p>
      )}
    </div>
  );
}

function ImportSummary({ result }: { result: MenuImportResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  const photos = result.items.filter((i) => i.image === 'set').length;
  const rows: [string, string][] = [
    [t('menu.import.rows'), format.number(result.rows)],
    [
      result.dryRun ? t('menu.import.willCreate') : t('menu.import.created'),
      format.number(result.created),
    ],
    [
      result.dryRun ? t('menu.import.willUpdate') : t('menu.import.updated'),
      format.number(result.updated),
    ],
    [t('menu.import.unchanged'), format.number(result.unchanged)],
    [t('menu.import.photosSet'), format.number(photos)],
    ...(result.retired.length > 0
      ? [[t('menu.import.willRetire'), format.number(result.retired.length)] as [string, string]]
      : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {result.createdCategories.length > 0 && (
        <p className="flex items-start gap-2 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('menu.import.newCategories', { names: result.createdCategories.join(', ') })}
        </p>
      )}
      {result.createdStations.length > 0 && (
        <p className="flex items-start gap-2 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('menu.import.newStations', { names: result.createdStations.join(', ') })}
        </p>
      )}
      {result.retired.length > 0 && (
        <p className="text-sm">
          {t('menu.import.retiredNames', {
            names: result.retired
              .slice(0, 20)
              .map((r) => r.name)
              .join(', '),
            count: result.retired.length,
          })}
        </p>
      )}
    </div>
  );
}
