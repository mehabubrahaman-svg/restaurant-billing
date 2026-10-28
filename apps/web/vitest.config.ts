import { defineConfig } from 'vitest/config';

// Standalone on purpose: tests need neither the React nor the Tailwind plugin
// (Vite transforms JSX itself).
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
  },
});
