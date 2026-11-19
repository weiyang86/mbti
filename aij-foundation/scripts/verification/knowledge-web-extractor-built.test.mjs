import {resolve} from 'node:path';
process.env.AF174_COMPILED_API_DIR=resolve('apps/api/dist');
await import('./knowledge-web-extractor.test.mjs');
