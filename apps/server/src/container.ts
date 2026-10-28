import type {
  Clock,
  EventBus,
  IdempotencyStore,
  IdGenerator,
  UnitOfWork,
} from '@restroos/application';
import {
  InProcessEventBus,
  SqliteIdempotencyStore,
  SqliteUnitOfWork,
  systemClock,
  uuidv7Generator,
  type SqliteDatabase,
} from '@restroos/infrastructure';
import { asFunction, asValue, createContainer, type AwilixContainer } from 'awilix';
import type { Logger } from 'pino';
import type { ServerConfig } from './config';

/** Everything the HTTP layer may resolve. Command/query handlers are registered here as they are built. */
export interface Cradle {
  config: ServerConfig;
  logger: Logger;
  db: SqliteDatabase;
  clock: Clock;
  ids: IdGenerator;
  eventBus: EventBus;
  unitOfWork: UnitOfWork;
  idempotencyStore: IdempotencyStore;
  startedAt: Date;
}

export interface ContainerOverrides {
  clock?: Clock;
  ids?: IdGenerator;
}

export function buildContainer(
  config: ServerConfig,
  logger: Logger,
  db: SqliteDatabase,
  overrides: ContainerOverrides = {},
): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({ strict: true });
  const clock = overrides.clock ?? systemClock;
  container.register({
    config: asValue(config),
    logger: asValue(logger),
    db: asValue(db),
    clock: asValue(clock),
    ids: asValue(overrides.ids ?? uuidv7Generator),
    startedAt: asValue(clock.now()),
    eventBus: asFunction(({ logger }: Cradle) => new InProcessEventBus(logger)).singleton(),
    unitOfWork: asFunction(
      ({ db, clock, ids, eventBus }: Cradle) => new SqliteUnitOfWork({ db, clock, ids, eventBus }),
    ).singleton(),
    idempotencyStore: asFunction(
      ({ db, clock }: Cradle) => new SqliteIdempotencyStore(db, clock),
    ).singleton(),
  });
  return container;
}
