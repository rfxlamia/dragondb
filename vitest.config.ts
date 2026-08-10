import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test.ts,test.tsx}'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
