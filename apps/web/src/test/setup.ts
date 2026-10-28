import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so testing-library cannot register its own cleanup.
afterEach(cleanup);

// `pnpm check` runs every package's tests in parallel; give async UI waits
// headroom so CPU contention does not turn into flaky failures.
configure({ asyncUtilTimeout: 5_000 });
