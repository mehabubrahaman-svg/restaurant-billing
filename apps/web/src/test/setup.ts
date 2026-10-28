import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setSocketFactory } from '../features/live/use-live-connection';
import { MemoryCommandStore } from '../features/offline/command-store';
import { resetCommandQueue } from '../features/offline/command-queue';
import { resetPad } from '../features/orders/pad-store';
import { useKdsFlags } from '../features/kitchen/kds-flags';
import { FakeSocket, fakeSocketFactory } from './fake-socket';

// Vitest runs without globals, so testing-library cannot register its own cleanup.
afterEach(cleanup);

// The live connection never touches the network in tests: each test plays the Hub.
setSocketFactory(fakeSocketFactory);

afterEach(() => {
  FakeSocket.reset();
  resetPad();
  resetCommandQueue(new MemoryCommandStore());
  useKdsFlags.setState({ delayed: new Set() });
});

// `pnpm check` runs every package's tests in parallel; give async UI waits
// headroom so CPU contention does not turn into flaky failures.
configure({ asyncUtilTimeout: 5_000 });
