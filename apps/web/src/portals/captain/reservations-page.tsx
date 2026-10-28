import type { DiningTable, Reservation, ReservationStatus } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Badge,
  Ban,
  Button,
  CalendarDays,
  Card,
  Clock,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
  SegmentedControl,
  Select,
  Stepper,
  StickyNote,
  Textarea,
  UserRound,
  Users,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { formatPhone } from '../../features/customers/customer-queries';
import { useFloor } from '../../features/floor/floor-queries';
import {
  localDay,
  refreshReservations,
  upcomingByDay,
  useReservations,
} from '../../features/floor/reservation-queries';
import { setOrder } from '../../features/orders/order-queries';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { canStartOrder } from './captain-page';
import { MAX_COVERS } from './covers-dialog';

type Show = 'upcoming' | 'all';

const STATUS_BADGE: Record<ReservationStatus, 'info' | 'success' | 'neutral' | 'danger'> = {
  BOOKED: 'info',
  SEATED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

/** "20:00" on the device's clock for an ISO instant, for the time input. */
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The next half hour from now: a sensible default for a new booking. */
function nextHalfHour(now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

/** /captain/reservations: bookings by day; book, change, seat, cancel, no-show. */
export function ReservationsPage() {
  const { t } = useTranslation();
  const reservations = useReservations();
  const floor = useFloor();
  const canManage = usePermission('reservations.manage');
  const [show, setShow] = useState<Show>('upcoming');
  const [editing, setEditing] = useState<Reservation | 'new' | null>(null);
  const tables = (floor.data?.areas ?? [])
    .filter((a) => a.isActive)
    .flatMap((a) => a.tables.filter((x) => x.isActive))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <title>{`${t('reservations.title')} · ${t('app.name')}`}</title>
      <div>
        <Button asChild variant="ghost">
          <Link to="/captain">
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            {t('reservations.back')}
          </Link>
        </Button>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{t('reservations.title')}</h1>
          <p className="text-muted-foreground">{t('reservations.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Show>
            aria-label={t('reservations.filter.label')}
            value={show}
            onValueChange={setShow}
            options={[
              { value: 'upcoming', label: t('reservations.filter.upcoming') },
              { value: 'all', label: t('reservations.filter.all') },
            ]}
          />
          {canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('reservations.new')}
            </Button>
          )}
        </div>
      </header>
      <QueryState query={reservations}>
        {({ data }) => (
          <ReservationList
            reservations={data.filter((r) => show === 'all' || r.status === 'BOOKED')}
            tables={tables}
            canManage={canManage}
            onEdit={setEditing}
          />
        )}
      </QueryState>
      {editing !== null && (
        <ReservationDialog
          reservation={editing === 'new' ? null : editing}
          tables={tables}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ReservationList({
  reservations,
  tables,
  canManage,
  onEdit,
}: {
  reservations: readonly Reservation[];
  tables: readonly DiningTable[];
  canManage: boolean;
  onEdit: (r: Reservation) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [seating, setSeating] = useState<Reservation | null>(null);
  if (reservations.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
        {t('reservations.empty')}
      </p>
    );
  }
  const today = localDay(new Date().toISOString());
  const tomorrow = localDay(new Date(Date.now() + 86_400_000).toISOString());
  const dayTitle = (day: string, first: string) =>
    day === today
      ? t('reservations.today')
      : day === tomorrow
        ? t('reservations.tomorrow')
        : format.dateTime(first, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-5">
      {upcomingByDay(reservations).map(({ day, reservations: list }) => (
        <section key={day} aria-labelledby={`day-${day}`} className="flex flex-col gap-2">
          <h2 id={`day-${day}`} className="flex items-center gap-2 font-semibold">
            <CalendarDays aria-hidden="true" className="size-5 text-muted-foreground" />
            {dayTitle(day, list[0]!.reservedFor)}
            <span className="text-sm font-normal text-muted-foreground">
              {t('reservations.guestsTotal', {
                count: list
                  .filter((r) => r.status === 'BOOKED')
                  .reduce((sum, r) => sum + r.partySize, 0),
              })}
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {list.map((r) => (
              <li key={r.id}>
                <ReservationRow
                  reservation={r}
                  canManage={canManage}
                  onEdit={() => onEdit(r)}
                  onSeat={() => setSeating(r)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {seating !== null && (
        <SeatDialog reservation={seating} tables={tables} onClose={() => setSeating(null)} />
      )}
    </div>
  );
}

function ReservationRow({
  reservation: r,
  canManage,
  onEdit,
  onSeat,
}: {
  reservation: Reservation;
  canManage: boolean;
  onEdit: () => void;
  onSeat: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const time = format.dateTime(r.reservedFor, { timeStyle: 'short' });
  const close = useMutation({
    mutationFn: (action: 'cancel' | 'no-show') => api.reservations.close(r.id, action, r.version),
    onSuccess: (_saved, action) => {
      refreshReservations(queryClient);
      toast(action === 'cancel' ? t('reservations.cancelled') : t('reservations.markedNoShow'));
    },
    onError: (error) => {
      refreshReservations(queryClient);
      toast(errorMessage(error), 'danger');
    },
  });
  const ask = (action: 'cancel' | 'no-show') => {
    const question =
      action === 'cancel'
        ? t('reservations.cancelConfirm', { name: r.guestName, time })
        : t('reservations.noShowConfirm', { name: r.guestName });
    if (window.confirm(question)) close.mutate(action);
  };
  const booked = r.status === 'BOOKED';

  return (
    <Card className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-lg font-bold tabular-nums">
        <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
        {time}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words">{r.guestName}</span>
          <Badge variant={STATUS_BADGE[r.status]}>{t(`reservations.status.${r.status}`)}</Badge>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users aria-hidden="true" className="size-4" />
            {t('reservations.guests', { count: r.partySize })}
          </span>
          <span>
            {r.tableLabel === null
              ? t('reservations.noTable')
              : t('reservations.tableNamed', { label: r.tableLabel })}
          </span>
          {r.guestPhone !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <UserRound aria-hidden="true" className="size-4" />
              {formatPhone(r.guestPhone)}
            </span>
          )}
        </span>
        {r.notes !== null && (
          <span className="inline-flex items-start gap-1 text-sm break-words">
            <StickyNote aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {r.notes}
          </span>
        )}
      </div>
      {canManage && booked && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSeat} disabled={close.isPending}>
            {t('reservations.seat')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            disabled={close.isPending}
            aria-label={t('reservations.editNamed', { name: r.guestName })}
          >
            <Pencil aria-hidden="true" />
            {t('common.edit')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => ask('no-show')}
            disabled={close.isPending}
          >
            {t('reservations.noShow')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => ask('cancel')}
            disabled={close.isPending}
          >
            <Ban aria-hidden="true" />
            {t('reservations.cancel')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Book a table ahead, or change a booking. */
export function ReservationDialog({
  reservation,
  tables,
  onClose,
}: {
  reservation: Reservation | null;
  tables: readonly DiningTable[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const start = reservation?.reservedFor ?? nextHalfHour().toISOString();
  const [name, setName] = useState(reservation?.guestName ?? '');
  const [phone, setPhone] = useState(reservation?.guestPhone ?? '');
  const [party, setParty] = useState(reservation?.partySize ?? 2);
  const [date, setDate] = useState(localDay(start));
  const [time, setTime] = useState(localTime(start));
  const [tableId, setTableId] = useState(reservation?.tableId ?? '');
  const [notes, setNotes] = useState(reservation?.notes ?? '');
  const [errors, setErrors] = useState<{ name?: boolean; when?: boolean }>({});

  const save = useMutation({
    mutationFn: async () => {
      const when = new Date(`${date}T${time}`);
      const found = {
        ...(name.trim() === '' ? { name: true } : {}),
        ...(Number.isNaN(when.getTime()) ? { when: true } : {}),
      };
      setErrors(found);
      if (Object.keys(found).length > 0) return null;
      const body = {
        guestName: name.trim(),
        guestPhone: phone.trim() === '' ? null : phone.trim(),
        partySize: party,
        reservedFor: when.toISOString(),
        tableId: tableId === '' ? null : tableId,
        notes: notes.trim() === '' ? null : notes.trim(),
      };
      return reservation === null
        ? api.reservations.create(body)
        : api.reservations.update(reservation.id, { ...body, version: reservation.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      refreshReservations(queryClient);
      toast(
        reservation === null
          ? t('reservations.saved', {
              name: saved.guestName,
              time: format.dateTime(saved.reservedFor, { dateStyle: 'medium', timeStyle: 'short' }),
            })
          : t('reservations.updated', { name: saved.guestName }),
      );
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
        reservation === null
          ? t('reservations.new')
          : t('reservations.editNamed', { name: reservation.guestName })
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('reservations.book')}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('reservations.guestName')}
            required
            error={errors.name === true ? t('reservations.nameError') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('reservations.guestPhone')} hint={t('reservations.phoneHint')}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('reservations.date')}
            required
            error={errors.when === true ? t('reservations.whenError') : undefined}
          >
            {(p) => (
              <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </Field>
          <Field label={t('reservations.time')} required>
            {(p) => (
              <Input
                {...p}
                type="time"
                step={300}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('reservations.partySize')}</span>
            <Stepper
              value={party}
              onValueChange={setParty}
              min={1}
              max={MAX_COVERS}
              display={format.number(party)}
              decrementLabel={t('order.covers.fewer')}
              incrementLabel={t('order.covers.more')}
            />
          </div>
          <Field label={t('reservations.table')} hint={t('reservations.tableHint')}>
            {(p) => (
              <Select {...p} value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">{t('reservations.noTable')}</option>
                {tables.map((x) => (
                  <option key={x.id} value={x.id}>
                    {t('reservations.tableOption', { label: x.label, seats: x.seats })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('reservations.notes')} className="sm:col-span-2">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={500}
                placeholder={t('reservations.notesPlaceholder')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** The guests arrived: pick a free table, mark the booking seated and start their order. */
function SeatDialog({
  reservation,
  tables,
  onClose,
}: {
  reservation: Reservation;
  tables: readonly DiningTable[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canOrder = usePermission('orders.create');
  const free = tables.filter(canStartOrder);
  const [tableId, setTableId] = useState(
    free.find((x) => x.id === reservation.tableId)?.id ??
      free.find((x) => x.seats >= reservation.partySize)?.id ??
      '',
  );
  const [covers, setCovers] = useState(Math.min(reservation.partySize, MAX_COVERS));
  // One key per dialog: a retry after a lost reply opens one order, not two.
  const [key] = useState(newIdempotencyKey);

  const seat = useMutation({
    mutationFn: async () => {
      await api.reservations.close(reservation.id, 'seat', reservation.version);
      if (!canOrder || tableId === '') return null;
      return api.orders.open({ orderType: 'DINE_IN', tableId, covers }, { idempotencyKey: key });
    },
    onSuccess: (order) => {
      refreshReservations(queryClient);
      toast(t('reservations.seated', { name: reservation.guestName }));
      onClose();
      if (order !== null) {
        setOrder(queryClient, order);
        void navigate(`/captain/orders/${order.id}`);
      }
    },
    onError: () => refreshReservations(queryClient),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!seat.isPending}
      closeLabel={t('common.close')}
      title={t('reservations.seatTitle', { name: reservation.guestName })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={seat.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => seat.mutate()} disabled={seat.isPending}>
            {canOrder && tableId !== ''
              ? t('reservations.seatAndOrder')
              : t('reservations.markSeated')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {seat.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(seat.error)}
          </Alert>
        )}
        {free.length === 0 ? (
          <Alert tone="warning">{t('reservations.noFreeTable')}</Alert>
        ) : (
          <Field label={t('reservations.table')} hint={t('reservations.seatHint')}>
            {(p) => (
              <Select {...p} value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">{t('reservations.seatLater')}</option>
                {free.map((x) => (
                  <option key={x.id} value={x.id}>
                    {t('reservations.tableOption', { label: x.label, seats: x.seats })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {canOrder && tableId !== '' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('reservations.partySize')}</span>
            <Stepper
              value={covers}
              onValueChange={setCovers}
              min={1}
              max={MAX_COVERS}
              display={format.number(covers)}
              decrementLabel={t('order.covers.fewer')}
              incrementLabel={t('order.covers.more')}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
