import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const path = resolve('scripts/runtime-environment.cjs');
const source = fs.readFileSync(path, 'utf8');
const root = dirname(dirname(path));
const normalize = value => JSON.parse(JSON.stringify(value));
function load() {
  const observations = [];
  const fakeFile = join(root, '.env');
  const controlledFs = {
    ...fs,
    existsSync(file) {
      if (file === fakeFile) { observations.push('probe-env'); return true; }
      return fs.existsSync(file);
    },
    readFileSync(file, ...args) {
      if (file === fakeFile) {
        observations.push('read-env');
        return 'SYNTHETIC_ROOT_ONLY=must-not-inherit\nAPI_PORT=3656\n';
      }
      return fs.readFileSync(file, ...args);
    }
  };
  const context = { module: { exports: {} }, __dirname: dirname(path), process,
    require: name => name === 'node:fs' ? controlledFs : require(name), URL };
  vm.runInNewContext(source, context, { filename: path });
  return { api: context.module.exports, observations };
}
const explicit = () => ({
  AIJ_RUNTIME_ENV_SOURCE: 'explicit', RUNTIME_PROFILE: 'project', AIJ_PROJECT_ROOT: root,
  PROJECT_ID: 'aij-ai-local', APP_ENV: 'development', WEB_PORT: '3955', API_PORT: '3956',
  WEB_URL: 'http://127.0.0.1:3955', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3956/api',
  JWT_ISSUER: 'urn:aij:aij-ai-local:development:api', COOKIE_PREFIX: 'aij_ai_local_development',
  LOCAL_STORAGE_ROOT: '.local-data/ai-local-development/aij-ai-local/development/storage'
});

test('explicit local AI environment neither probes nor reads an existing repository env and returns the exact explicit object', () => {
  const { api, observations } = load(), input = explicit();
  const result = api.readRepositoryEnvironment(input);
  assert.deepEqual(normalize(result), input); assert.equal(result, input);
  assert.equal(result.SYNTHETIC_ROOT_ONLY, undefined);
  assert.deepEqual(observations, []);
});
test('malformed explicit opt-in and any other root, product, environment or port reject before env IO', () => {
  const changes = [
    { AIJ_RUNTIME_ENV_SOURCE: '' }, { AIJ_RUNTIME_ENV_SOURCE: 'auto' }, { AIJ_RUNTIME_ENV_SOURCE: null },
    { RUNTIME_PROFILE: 'host' }, { PROJECT_ID: 'aij-foundation' }, { PROJECT_ID: 'another-product' },
    { APP_ENV: 'test' }, { APP_ENV: 'production' }, { AIJ_PROJECT_ROOT: undefined },
    { AIJ_PROJECT_ROOT: '/private/tmp' }, { WEB_PORT: '3655' }, { API_PORT: '3656' },
    { WEB_PORT: 3955 }, { API_PORT: undefined }
  ];
  for (const change of changes) {
    const { api, observations } = load();
    assert.throws(() => api.readRepositoryEnvironment({ ...explicit(), ...change }), /fixed independent local AI identity/);
    assert.deepEqual(observations, []);
  }
});
test('public Next production mode loads the isolated development identity without inheriting root settings', () => {
  const { api, observations } = load();
  const runtime = api.loadRuntimeEnvironment({ ...explicit(), NODE_ENV: 'production' });
  assert.equal(runtime.namespace, 'aij-ai-local:development'); assert.equal(runtime.profile, 'project');
  assert.equal(runtime.webPort, 3955); assert.equal(runtime.apiPort, 3956);
  assert.equal(runtime.nodeEnv, 'production'); assert.equal(runtime.databaseTarget, null);
  assert.deepEqual(observations, []);
});
test('explicit mode still enforces real capability secret and project database policies', () => {
  for (const extra of [
    { AUTH_ENABLED: 'true', DATABASE_ENABLED: 'true', JWT_SECRET: '' },
    { DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://foreign:invalid@127.0.0.1:55432/aij_foundation_dev' }
  ]) {
    const { api, observations } = load();
    assert.throws(() => api.loadRuntimeEnvironment({ ...explicit(), ...extra }));
    assert.deepEqual(observations, []);
  }
});
test('host and existing Base callers without the new marker retain reviewed env file precedence', () => {
  for (const input of [{}, { RUNTIME_PROFILE: 'project', AIJ_PROJECT_ROOT: root, PROJECT_ID: 'aij-base-dev', API_PORT: '3856' }]) {
    const { api, observations } = load(), result = api.readRepositoryEnvironment(input);
    assert.equal(result.SYNTHETIC_ROOT_ONLY, 'must-not-inherit');
    assert.equal(result.API_PORT, input.API_PORT ?? '3656');
    assert.deepEqual(observations, ['probe-env', 'read-env']);
  }
});
