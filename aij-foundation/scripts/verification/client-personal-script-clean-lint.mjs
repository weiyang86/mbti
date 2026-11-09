import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const declaration = 'apps/web/app/components/client-personal-script-state.d.mts';
const parent = 'aa9b947f1af892a89ff97fef1911b6b78cade74f';
let config = execFileSync('git', ['show', parent + ':eslint.config.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const anchor = 'const webFiles = ["apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"];'; assert.ok(config.includes(anchor));
config = config.replace(anchor, anchor + '\nconst scriptDeclarationFile = ' + JSON.stringify(declaration) + ';\nconst scriptDeclarationParser = nextVitals.find(config => config.name === "next/typescript");\nif (!scriptDeclarationParser) throw new Error("Matching Next TypeScript parser configuration is required");');
assert.ok(config.includes('ignores: ["apps/web/**/*.ts", "apps/web/**/*.tsx"]'));
config = config.replace('ignores: ["apps/web/**/*.ts", "apps/web/**/*.tsx"]', 'ignores: ["apps/web/**/*.ts", "apps/web/**/*.tsx", scriptDeclarationFile]');
config = config.replace('  ...scopedNextVitals,', '  ...scopedNextVitals,\n  { ...scriptDeclarationParser, files: [scriptDeclarationFile] },');
const directory = resolve('.artifacts/auto-ai-program-20261105/W20'); mkdirSync(directory, { recursive: true });
const path = resolve(directory, 'AF-213-eslint-projection.mjs'); writeFileSync(path, config);
const files = ['eslint.config.mjs', 'apps/web/app/components/client-personal-script-panel.tsx', 'apps/web/app/components/client-personal-script-state.mjs', declaration,
  'apps/web/app/components/client-skill-library.tsx', 'scripts/verification/client-personal-script-state.test.mjs', 'scripts/verification/client-personal-script-acceptance.mjs',
  'scripts/verification/client-personal-script-live.test.mjs', 'scripts/verification/client-personal-script-browser.mjs', 'scripts/verification/client-personal-script-browser-host.mjs', 'scripts/verification/client-personal-script-clean-lint.mjs'];
const result = spawnSync('pnpm', ['exec', 'eslint', '--config', path, ...files, '--max-warnings=0'], { stdio: 'inherit', shell: false });
assert.equal(result.error, undefined); assert.equal(result.status, 0, 'AF213 exact isolated parser pairing lint failed');
console.log(JSON.stringify({ status: 'PASS', frozenParent: parent, projection: path, exactNewDeclarationPair: declaration, rulesDisabled: false, inheritedAf203ConfigNotRequired: true }));
