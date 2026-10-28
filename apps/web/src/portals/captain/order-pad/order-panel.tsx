import type { KotStatus, MenuSnapshot, Order, OrderItem } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Ban,
  Badge,
  Button,
  CloudOff,
  cn,
  Flag,
  Pencil,
  RotateCcw,
  Send,
  Spinner,
  StateChip,
  Stepper,
  Trash,
  type KotState,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/client';
import { api } from '../../../api/endpoints';
import { usePermission } from '../../../features/auth/permissions';
import { FoodTypeMark } from '../../../features/menu/food-type';
import {
  discardCommand,
  retryCommand,
  runCommand,
  useCommandQueue,
} from '../../../features/offline/command-queue';
import type { QueuedCommand } from '../../../features/offline/command-types';
import {
  kotGroups,
  lineNames,
  newLines,
  padTotals,
  type NewLine,
} from '../../../features/orders/order-lines';
import { ReprintKotButton } from '../../../features/kitchen/reprint-kot-button';
import { applyKotToOrder, setOrder } from '../../../features/orders/order-queries';
import {
  editQuantity,
  fireOrder,
  forgetQuantity,
  setDraftNote,
  setDraftQuantity,
  usePadStore,
} from '../../../features/orders/pad-store';
import { toast } from '../../../features/toast/toast-store';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { CancelItemDialog, NoteDialog } from './order-dialogs';

const KOT_CHIP: Readonly<Record<Exclude<KotStatus, 'CANCELLED'>, KotState>> = {
  NEW: 'new',
  ACCEPTED: 'accepted',
  COOKING: 'cooking',
  READY: 'ready',
  SERVED: 'served',
};

/** A KOT's chip; one whose every line was cancelled shows as cancelled (ban icon, red). */
function KotChip({ status }: { status: KotStatus }) {
  const { t } = useTranslation();
  if (status === 'CANCELLED') {
    return <StateChip size="sm" state="blocked" label={t('order.line.cancelled')} />;
  }
  const state = KOT_CHIP[status];
  return <StateChip size="sm" state={state} label={t(`state.kot.${state}`)} />;
}

const EMPTY: readonly never[] = [];

/**
 * The order side of the pad (wireframes §5): lines already sent, grouped by
 * KOT with their kitchen status; new lines with −/+ and notes; the subtotal;
 * and "Send to kitchen (n)".
 */
export function OrderPanel({
  order,
  menu,
  editable,
}: {
  order: Order;
  menu: MenuSnapshot | undefined;
  /** The order is OPEN and this user may change it. */
  editable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canFire = usePermission('orders.fire_kot');
  const drafts = usePadStore((s) => s.drafts[order.id] ?? EMPTY);
  const qtyEdits = usePadStore((s) => s.qtyEdits);
  const saving = usePadStore((s) => s.saving[order.id] ?? false);
  const padError = usePadStore((s) => s.errors[order.id]);
  const commands = useCommandQueue((s) => s.commands);
  const lines = newLines(order, drafts, qtyEdits, commands);
  const { subtotal, pendingUnits } = padTotals(lines, order);
  const groups = kotGroups(order);
  const mine = commands.filter((c) => c.orderId === order.id);
  const queuedFire = mine.some((c) => c.kind === 'fire' && c.status !== 'failed');
  const failedOther = mine.filter((c) => c.status === 'failed' && c.kind !== 'addItems');
  const [noteFor, setNoteFor] = useState<NewLine | null>(null);
  const [cancelFor, setCancelFor] = useState<OrderItem | null>(null);
  const names = (item: OrderItem) => lineNames(item, menu, i18n.language);

  const fire = useMutation({
    mutationFn: () => fireOrder(queryClient, order.id),
    onSuccess: (outcome) => {
      if (outcome.status === 'queued') {
        toast(t('order.fire.queued'), 'warning');
        return;
      }
      const fresh = outcome.order.kots.filter((k) => !order.kots.some((o) => o.id === k.id));
      toast(
        t('order.fire.sent', {
          count: fresh.length,
          kots: fresh.map((k) => format.number(k.kotNo)).join(', '),
        }),
      );
    },
  });

  const removePending = useMutation({
    mutationFn: async (item: OrderItem) => {
      forgetQuantity(item.id);
      const outcome = await runCommand({
        kind: 'cancelItem',
        orderId: order.id,
        itemId: item.id,
        method: 'POST',
        path: `/orders/${order.id}/items/${item.id}/cancel`,
        body: { version: item.version, isWastage: false },
      });
      if (outcome.status === 'done') setOrder(queryClient, outcome.order);
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });

  const saveNote = useMutation({
    mutationFn: async ({ item, note }: { item: OrderItem; note: string }) => {
      const outcome = await runCommand({
        kind: 'updateItem',
        orderId: order.id,
        itemId: item.id,
        method: 'PATCH',
        path: `/orders/${order.id}/items/${item.id}`,
        body: { version: item.version, specialNote: note === '' ? null : note },
      });
      if (outcome.status === 'done') setOrder(queryClient, outcome.order);
    },
    onSuccess: () => setNoteFor(null),
  });

  const served = useMutation({
    mutationFn: ({ kotId, version }: { kotId: string; version: number }) =>
      api.kitchen.setStatus(kotId, 'SERVED', version),
    onSuccess: (kot) => applyKotToOrder(queryClient, kot),
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  const canServe = usePermission(['orders.update', 'kds.update_status']);

  const noteName =
    noteFor === null
      ? ''
      : noteFor.kind === 'pending'
        ? names(noteFor.item).name
        : noteFor.kind === 'draft'
          ? noteFor.draft.preview.name
          : noteFor.preview.name;

  return (
    <section
      aria-labelledby="order-panel-title"
      className="flex min-w-0 flex-col rounded-xl border bg-surface md:min-h-0"
    >
      <h2 id="order-panel-title" className="border-b px-4 py-3 text-lg font-semibold">
        {t('order.panel.title', { orderNo: order.orderNo })}
      </h2>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {queuedFire && (
          <Alert tone="warning" role="status" title={t('order.fire.notNotifiedTitle')}>
            {t('order.fire.notNotified')}
          </Alert>
        )}
        {padError !== undefined && (
          <Alert tone="danger" role="alert">
            {t('order.pad.saveFailed', { reason: errorMessage(padError) })}
          </Alert>
        )}
        {fire.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(fire.error)}
          </Alert>
        )}
        {failedOther.map((c) => (
          <FailedCommand key={c.id} command={c} />
        ))}

        {groups.map(({ kot, items }) => (
          <section key={kot.id} aria-label={t('order.kot.label', { kotNo: kot.kotNo })}>
            <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {kot.stationName === null
                  ? t('order.kot.title', { kotNo: kot.kotNo })
                  : t('order.kot.titleStation', { kotNo: kot.kotNo, station: kot.stationName })}
              </h3>
              <span className="flex items-center gap-2">
                <KotChip status={kot.status} />
                <ReprintKotButton kotId={kot.id} kotNo={kot.kotNo} />
              </span>
            </header>
            <ul className="flex flex-col divide-y">
              {items.map((item) => (
                <SentLine
                  key={item.id}
                  item={item}
                  names={names(item)}
                  onCancel={
                    editable && item.status !== 'CANCELLED' && item.status !== 'SERVED'
                      ? () => setCancelFor(item)
                      : null
                  }
                />
              ))}
            </ul>
            {kot.status === 'READY' && canServe && (
              <Button
                variant="outline"
                className="mt-2 w-full"
                disabled={served.isPending}
                onClick={() => served.mutate({ kotId: kot.id, version: kot.version })}
              >
                {t('order.kot.markServed', { kotNo: kot.kotNo })}
              </Button>
            )}
          </section>
        ))}

        <section aria-labelledby="new-lines-title">
          <h3
            id="new-lines-title"
            className="mb-1 flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            {t('order.pad.newTitle')}
            {saving && <Spinner label={t('common.saving')} className="size-4" />}
          </h3>
          {lines.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {groups.length === 0 ? t('order.pad.empty') : t('order.pad.nothingNew')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {lines.map((line) => (
                <NewLineRow
                  key={line.key}
                  line={line}
                  names={line.kind === 'pending' ? names(line.item) : null}
                  editable={editable}
                  onQuantity={(quantity) => {
                    if (line.kind === 'pending') {
                      if (quantity <= 0) removePending.mutate(line.item);
                      else
                        editQuantity(
                          queryClient,
                          order.id,
                          line.item.id,
                          quantity,
                          line.item.version,
                        );
                    } else if (line.kind === 'draft') {
                      setDraftQuantity(queryClient, order.id, line.draft.key, quantity);
                    }
                  }}
                  onNote={() => setNoteFor(line)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="flex flex-col gap-3 border-t p-4">
        <p className="flex items-baseline justify-between gap-2 text-lg">
          <span>{t('order.pad.subtotal')}</span>
          <span className="font-bold tabular-nums">{format.money(Money.ofPaise(subtotal))}</span>
        </p>
        {editable && canFire && (
          <Button
            size="lg"
            className="w-full"
            // A queued "send" already covers these lines; a second one would find nothing to fire.
            disabled={pendingUnits === 0 || fire.isPending || queuedFire}
            onClick={() => fire.mutate()}
          >
            <Send aria-hidden="true" />
            {t('order.fire.button', { count: pendingUnits })}
          </Button>
        )}
      </footer>

      {noteFor !== null && (
        <NoteDialog
          name={noteName}
          note={
            noteFor.kind === 'pending'
              ? noteFor.item.specialNote
              : noteFor.kind === 'draft'
                ? (noteFor.draft.request.specialNote ?? null)
                : noteFor.preview.specialNote
          }
          busy={saveNote.isPending}
          error={saveNote.isError ? errorMessage(saveNote.error) : null}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            if (noteFor.kind === 'pending') saveNote.mutate({ item: noteFor.item, note });
            else if (noteFor.kind === 'draft') {
              setDraftNote(queryClient, order.id, noteFor.draft.key, note);
              setNoteFor(null);
            }
          }}
        />
      )}
      {cancelFor !== null && (
        <CancelItemDialog
          order={order}
          item={cancelFor}
          name={names(cancelFor).name}
          onClose={() => setCancelFor(null)}
        />
      )}
    </section>
  );
}

function LineText({
  name,
  variantName,
  addons,
  note,
  struck = false,
}: {
  name: string;
  variantName: string | null;
  addons: readonly string[];
  note: string | null;
  struck?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn('flex min-w-0 flex-col', struck && 'text-muted-foreground line-through')}>
      <span className="font-medium break-words">
        {variantName === null ? name : t('order.line.withVariant', { name, variant: variantName })}
      </span>
      {addons.length > 0 && (
        <span className="text-sm text-muted-foreground">
          {t('order.line.addons', { addons: addons.join(', ') })}
        </span>
      )}
      {note !== null && note !== '' && (
        <span className="flex items-center gap-1 text-sm text-state-reserved-fg">
          <Flag aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="break-words">{note}</span>
        </span>
      )}
    </span>
  );
}

function SentLine({
  item,
  names,
  onCancel,
}: {
  item: OrderItem;
  names: { name: string; variantName: string | null; addons: string[] };
  onCancel: (() => void) | null;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const cancelled = item.status === 'CANCELLED';
  return (
    <li className="flex items-start gap-2 py-2" data-status={item.status}>
      <FoodTypeMark type={item.foodType} size="sm" className="mt-1.5" />
      <span className="w-8 shrink-0 pt-0.5 font-semibold tabular-nums">
        {t('order.line.qty', { quantity: item.quantity })}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <LineText {...names} note={item.specialNote} struck={cancelled} />
        {cancelled ? (
          <span className="text-xs text-state-danger-fg">
            {item.cancelReason === null
              ? t('order.line.cancelled')
              : t('order.line.cancelledReason', { reason: item.cancelReason })}
          </span>
        ) : item.status === 'READY' ? (
          <Badge variant="success" className="self-start">
            {t('order.line.ready')}
          </Badge>
        ) : null}
      </div>
      <span className="shrink-0 pt-0.5 text-sm tabular-nums">
        {format.money(Money.ofPaise(item.lineTotal), { symbol: false })}
      </span>
      {onCancel !== null && (
        <button
          type="button"
          aria-label={t('order.cancel.itemAction', { name: names.name })}
          onClick={onCancel}
          className="grid size-touch shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-state-danger-fg"
        >
          <Ban aria-hidden="true" className="size-5" />
        </button>
      )}
    </li>
  );
}

function NewLineRow({
  line,
  names,
  editable,
  onQuantity,
  onNote,
}: {
  line: NewLine;
  names: { name: string; variantName: string | null; addons: string[] } | null;
  editable: boolean;
  onQuantity: (quantity: number) => void;
  onNote: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const text =
    line.kind === 'pending'
      ? { ...names!, note: line.item.specialNote }
      : line.kind === 'draft'
        ? {
            name: line.draft.preview.name,
            variantName: line.draft.preview.variantName,
            addons: line.draft.preview.addons,
            note: line.draft.request.specialNote ?? null,
          }
        : {
            name: line.preview.name,
            variantName: line.preview.variantName,
            addons: line.preview.addons,
            note: line.preview.specialNote,
          };
  const quantity =
    line.kind === 'pending'
      ? line.quantity
      : line.kind === 'draft'
        ? line.draft.request.quantity
        : line.preview.quantity;
  const total =
    line.kind === 'pending'
      ? line.lineTotal
      : line.kind === 'draft'
        ? line.draft.unitTotal * line.draft.request.quantity
        : line.preview.lineTotal;
  const foodType =
    line.kind === 'pending'
      ? line.item.foodType
      : line.kind === 'draft'
        ? line.draft.preview.foodType
        : line.preview.foodType;
  const adjustable = editable && (line.kind === 'pending' || line.kind === 'draft');

  return (
    <li className="flex flex-col gap-1 py-2" data-kind={line.kind}>
      <div className="flex items-start gap-2">
        <FoodTypeMark type={foodType} size="sm" className="mt-1.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <LineText {...text} />
          {line.kind === 'queued' && (
            <Badge variant="warning" className="self-start">
              <CloudOff aria-hidden="true" />
              {t('order.line.queued')}
            </Badge>
          )}
          {line.kind === 'pending' && line.queuedChange && (
            <Badge variant="warning" className="self-start">
              <CloudOff aria-hidden="true" />
              {t('order.line.changeQueued')}
            </Badge>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-sm tabular-nums">
          {format.money(Money.ofPaise(total), { symbol: false })}
        </span>
      </div>
      {line.kind === 'failed' ? (
        <FailedCommand command={line.command} />
      ) : (
        adjustable && (
          <div className="flex flex-wrap items-center justify-between gap-2 ps-6">
            <Button variant="ghost" size="touch" onClick={onNote} className="px-2">
              <Pencil aria-hidden="true" />
              {text.note === null || text.note === '' ? t('order.note.add') : t('order.note.edit')}
            </Button>
            <Stepper
              value={quantity}
              min={0}
              onValueChange={onQuantity}
              display={format.number(quantity)}
              decrementLabel={
                quantity === 1
                  ? t('order.line.remove', { name: text.name })
                  : t('order.line.fewer', { name: text.name })
              }
              incrementLabel={t('order.line.more', { name: text.name })}
            />
          </div>
        )
      )}
      {!adjustable && line.kind !== 'failed' && (
        <span className="ps-6 text-sm text-muted-foreground">
          {t('order.line.qtyLong', { quantity })}
        </span>
      )}
    </li>
  );
}

/** A queued request the Hub refused (409 or other 4xx): try again, or throw it away. */
function FailedCommand({ command }: { command: QueuedCommand }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const reason = errorMessage(
    new ApiError(command.error?.status ?? 0, command.error?.code ?? 'UNKNOWN', null),
  );
  return (
    <Alert tone="danger" role="alert" title={t(`order.attention.${command.kind}`)}>
      <p>{t('order.attention.body', { reason })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void retryCommand(command.id)}>
          <RotateCcw aria-hidden="true" />
          {t('common.retry')}
        </Button>
        <Button variant="outline" onClick={() => void discardCommand(command.id)}>
          <Trash aria-hidden="true" />
          {t('order.attention.discard')}
        </Button>
      </div>
    </Alert>
  );
}
