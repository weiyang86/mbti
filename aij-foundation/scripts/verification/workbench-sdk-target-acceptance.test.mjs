// Root execution wrapper only. It does not implement or substitute the mandatory real adapter.
import { resolve } from 'node:path';
process.env.AIJ_AF191_ROOT_ACCEPTANCE = 'true';
process.env.AIJ_AF191_ROOT_ADAPTER = resolve('scripts/verification/workbench-sdk-target-root.mjs');
await import('./workbench-sdk-target-live.test.mjs');
