import { Button, CircleCheck, cn, Flame, Spinner, Volume2 } from '@restroos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionStatus } from '../../features/connection/connection-store';
import { ConnectionPill } from '../../features/connection/connection-pill';
import { useThemeStore } from '../../features/theme/theme-store';
import { useTokenBoard } from '../../features/tokens/token-queries';
import { useFormat } from '../../i18n/use-format';
import { audioReady, chime, unlockAudio } from '../../lib/chime';
import { useSoundStore } from '../../stores/sound-store';

/** A newly ready token pulses this long. */
export const TOKEN_FRESH_MS = 8_000;

/**
 * The customer TV (wireframes §9): PREPARING on one half, READY on the
 * other. A token that just became ready pulses and chimes. Data: GET /tokens
 * (public), `token.ready` live messages, and a 10-second refetch as a safety
 * net. Runs on a paired TOKEN_DISPLAY device with nobody signed in.
 */
export function TokenDisplayPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const board = useTokenBoard();
  const status = useConnectionStatus();
  const muted = useSoundStore((s) => s.muted);
  const dark = useThemeStore((s) => s.preference === null);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  const [sound, setSound] = useState(audioReady);
  const seen = useRef<ReadonlySet<number> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const ready = board.data?.ready;

  // Newly ready tokens (from the live feed or the safety-net refetch) pulse and chime once.
  useEffect(() => {
    if (ready === undefined) return;
    const previous = seen.current;
    seen.current = new Set(ready);
    if (previous === null) return;
    const added = ready.filter((n) => !previous.has(n));
    if (added.length === 0) return;
    chime('token');
    setFresh((f) => new Set([...f, ...added]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFresh((f) => new Set([...f].filter((n) => !added.includes(n))));
    }, TOKEN_FRESH_MS);
    timers.current.add(timer);
  }, [ready]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const preparing = board.data?.preparing ?? [];
  const readyList = [...(ready ?? [])].reverse();

  return (
    <main
      id="main"
      data-theme={dark ? 'dark' : undefined}
      className="relative grid min-h-dvh grid-rows-[auto_1fr] bg-background text-foreground"
    >
      <title>{`${t('tokens.title')} · ${t('app.name')}`}</title>
      <h1 className="sr-only">{t('tokens.title')}</h1>
      <div className="absolute end-3 bottom-3 z-10 flex items-center gap-2">
        {!muted && !sound && (
          <Button
            variant="outline"
            onClick={() => void unlockAudio().then(setSound)}
            className="bg-surface/80"
          >
            <Volume2 aria-hidden="true" />
            {t('tokens.enableSound')}
          </Button>
        )}
        {status !== 'live' && <ConnectionPill />}
      </div>
      {board.isPending ? (
        <div className="row-span-2 grid place-items-center">
          <Spinner label={t('tokens.connecting')} />
        </div>
      ) : board.isError && board.data === undefined ? (
        <p role="alert" className="row-span-2 grid place-items-center p-8 text-center text-2xl">
          {t('tokens.unavailable')}
        </p>
      ) : (
        <div className="row-span-2 grid grid-cols-2 divide-x divide-border">
          <section aria-labelledby="tokens-preparing" className="flex flex-col">
            <h2
              id="tokens-preparing"
              className="flex items-center justify-center gap-3 bg-state-reserved-soft py-4 text-[clamp(1.75rem,3.5vw,3.5rem)] font-bold tracking-wide text-state-reserved-fg uppercase"
            >
              <Flame aria-hidden="true" className="size-[1em]" />
              {t('tokens.preparing')}
            </h2>
            <TokenList tokens={preparing} label={t('tokens.preparing')} format={format.number} />
          </section>
          <section aria-labelledby="tokens-ready" className="flex flex-col">
            <h2
              id="tokens-ready"
              className="flex items-center justify-center gap-3 bg-state-available-soft py-4 text-[clamp(1.75rem,3.5vw,3.5rem)] font-bold tracking-wide text-state-available-fg uppercase"
            >
              <CircleCheck aria-hidden="true" className="size-[1em]" />
              {t('tokens.ready')}
            </h2>
            <TokenList
              tokens={readyList}
              label={t('tokens.ready')}
              format={format.number}
              fresh={fresh}
              big
            />
          </section>
        </div>
      )}
    </main>
  );
}

function TokenList({
  tokens,
  label,
  format,
  fresh,
  big = false,
}: {
  tokens: readonly number[];
  label: string;
  format: (n: number) => string;
  fresh?: ReadonlySet<number>;
  big?: boolean;
}) {
  const { t } = useTranslation();
  if (tokens.length === 0) {
    return <p className="p-8 text-center text-2xl text-muted-foreground">{t('tokens.none')}</p>;
  }
  return (
    <ul
      aria-label={label}
      className={cn(
        'grid content-start justify-items-center gap-4 p-6',
        big
          ? 'grid-cols-[repeat(auto-fill,minmax(min(12rem,40vw),1fr))]'
          : 'grid-cols-[repeat(auto-fill,minmax(min(9rem,30vw),1fr))]',
      )}
    >
      {tokens.map((n) => {
        const isFresh = fresh?.has(n) ?? false;
        return (
          <li
            key={n}
            data-fresh={isFresh || undefined}
            className={cn(
              'grid w-full place-items-center rounded-2xl border-2 font-bold tabular-nums',
              big
                ? 'border-state-available py-3 text-[clamp(3rem,7vw,8rem)] text-state-available-fg'
                : 'border-border py-2 text-[clamp(2.25rem,5vw,6rem)]',
              isFresh && 'token-fresh bg-state-available-soft',
            )}
          >
            {format(n)}
          </li>
        );
      })}
    </ul>
  );
}
