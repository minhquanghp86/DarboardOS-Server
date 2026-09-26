// Thu tich hop (server + Chromium that): npm run test:integration. Tach khoi unit test (npm test) vi can Chromium va
// chay lau hon nhieu (moi test khoi dong mot server moi).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/integration/**/*.itest.ts'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
