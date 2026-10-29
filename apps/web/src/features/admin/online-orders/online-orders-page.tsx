import type { RelayMessage, RelayOverview } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  RotateCcw,
  Send,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { tDynamic } from '../../../lib/dynamic-t';
import { useErrorMessage } from '../../../lib/errors';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

export const RELAY_KEY = ['integrations', 'relay'] as const;
/** The status is a live connection: look again this often while on screen. */
const REFRESH_MS = 10_000;

const STATE_TONE = {
  CONNECTED: 'success',
  CONNECTING: 'warning',
  DISCONNECTED: 'danger',
  OFF: 'neutral',
} as const;

/** /admin/online-orders: the link to the cloud relay, for Swiggy, Zomato … through a middleware. */
export function OnlineOrdersPage() {
  const { t } = useTranslation();
  const relay = useQuery({
    queryKey: RELAY_KEY,
    queryFn: api.integrations.relay,
    refetchInterval: REFRESH_MS,
  });
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title={t('online.title')} description={t('online.description')} />
      <QueryState query={relay}>
        {(data) => (
          <>
            <StatusCard overview={data} />
            <LinkForm key={data.link?.version ?? 0} overview={data} />
            <Messages messages={data.recent} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function StatusCard({ overview }: { overview: RelayOverview }) {
  const { t } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { status, counts } = overview;
  const push = useMutation({
    mutationFn: api.integrations.pushMenu,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RELAY_KEY });
      toast(t('online.menuQueued'));
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={STATE_TONE[status.state]}>{t(`online.states.${status.state}`)}</Badge>
          {status.lastConnectedAt !== null && (
            <span className="text-sm text-muted-foreground">
              {t('online.lastConnected', {
                when: format.dateTime(status.lastConnectedAt, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </span>
          )}
        </span>
        <Button
          variant="outline"
          disabled={push.isPending || overview.link?.isEnabled !== true}
          onClick={() => push.mutate()}
        >
          <Send aria-hidden="true" />
          {t('online.pushMenu')}
        </Button>
      </div>
      {status.lastError !== null && status.state !== 'CONNECTED' && (
        <Alert tone="danger">{status.lastError}</Alert>
      )}
      <p className="text-sm">
        {[
          t('online.pendingOut', { count: counts.pendingOut }),
          t('online.failedIn', { count: counts.failedIn }),
        ].join(' · ')}
      </p>
    </Card>
  );
}

interface Errors {
  relayUrl?: string;
  hubId?: string;
  hubKey?: string;
}

function LinkForm({ overview }: { overview: RelayOverview }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const link = overview.link;
  const [relayUrl, setRelayUrl] = useState(link?.relayUrl ?? '');
  const [hubId, setHubId] = useState(link?.hubId ?? '');
  const [hubKey, setHubKey] = useState('');
  const [enabled, setEnabled] = useState(link?.isEnabled ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const save = useMutation({
    mutationFn: api.integrations.saveRelay,
    onSuccess: (next) => {
      queryClient.setQueryData(RELAY_KEY, next);
      toast(t('online.saved'));
    },
  });

  function submit() {
    const found: Errors = {};
    if (!/^(wss?|https?):\/\/\S+$/.test(relayUrl.trim())) found.relayUrl = t('online.urlInvalid');
    if (hubId.trim().length < 4) found.hubId = t('online.hubIdInvalid');
    if (link === null && hubKey.trim().length < 16) found.hubKey = t('online.keyInvalid');
    else if (hubKey.trim() !== '' && hubKey.trim().length < 16)
      found.hubKey = t('online.keyInvalid');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate({
      relayUrl: relayUrl.trim(),
      hubId: hubId.trim(),
      ...(hubKey.trim() === '' ? {} : { hubKey: hubKey.trim() }),
      isEnabled: enabled,
      ...(link === null ? {} : { version: link.version }),
    });
  }

  return (
    <section aria-labelledby="online-link" className="flex flex-col gap-2">
      <h2 id="online-link" className="font-semibold">
        {t('online.link')}
      </h2>
      <Card className="p-4">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {save.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(save.error)}
            </Alert>
          )}
          <Field
            label={t('online.relayUrl')}
            hint={t('online.relayUrlHint')}
            error={errors.relayUrl}
          >
            {(p) => (
              <Input
                {...p}
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="wss://relay.example.com"
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('online.hubId')} error={errors.hubId}>
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={hubId}
                  onChange={(e) => setHubId(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('online.hubKey')}
              hint={link?.keySet ? t('online.keyKept') : t('online.keyHint')}
              error={errors.hubKey}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={hubKey}
                  onChange={(e) => setHubKey(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Switch
            label={t('online.enabled')}
            description={t('online.enabledHint')}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function Messages({ messages }: { messages: RelayMessage[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => api.integrations.retry(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: RELAY_KEY });
      toast(
        result.ok ? t('online.retried') : (result.error ?? t('online.retryFailed')),
        result.ok ? 'success' : 'danger',
      );
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  return (
    <section aria-labelledby="online-messages" className="flex flex-col gap-2">
      <h2 id="online-messages" className="font-semibold">
        {t('online.messages')}
      </h2>
      {messages.length === 0 ? (
        <p className="text-muted-foreground">{t('online.noMessages')}</p>
      ) : (
        <Table aria-label={t('online.messages')}>
          <THead>
            <Tr>
              <Th>{t('online.when')}</Th>
              <Th>{t('online.what')}</Th>
              <Th>{t('online.order')}</Th>
              <Th>{t('online.status')}</Th>
              <Th>
                <span className="sr-only">{t('online.actions')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {messages.map((m) => (
              <Tr key={m.id}>
                <Td className="whitespace-nowrap">
                  {format.dateTime(m.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                </Td>
                <Td>{tDynamic(t, `online.kinds.${m.direction}.${kindKey(m.kind)}`, m.kind)}</Td>
                <Td className="break-all">
                  {m.externalOrderId === null ? '' : `${m.channelCode ?? ''} ${m.externalOrderId}`}
                </Td>
                <Td>
                  <Badge
                    variant={
                      m.status === 'FAILED'
                        ? 'danger'
                        : m.status === 'PENDING'
                          ? 'warning'
                          : 'success'
                    }
                  >
                    {t(`online.statuses.${m.status}`)}
                  </Badge>
                  {m.error !== null && (
                    <span className="block text-sm break-words text-state-danger-fg">
                      {m.error}
                    </span>
                  )}
                </Td>
                <Td className="text-end">
                  {m.direction === 'IN' && m.status === 'FAILED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(m.id)}
                    >
                      <RotateCcw aria-hidden="true" />
                      {t('online.retry')}
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/** order.created → orderCreated, order-status → orderStatus. */
const kindKey = (kind: string) => kind.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase());
