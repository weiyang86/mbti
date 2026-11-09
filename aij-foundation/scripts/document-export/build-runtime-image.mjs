import { spawn } from 'node:child_process';
import { mkdtemp, cp, readdir, lstat, readFile, rm, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const NODE_IMAGE = 'docker.io/library/node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20';
const FONT = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b';
export async function assertBundleTree(directory) {
  let count = 0, size = 0;
  async function visit(path) {
    const st = await lstat(path);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw Error('UNSAFE_BUNDLE');
    if (++count > 10000 || (size += st.size) > 128 * 1024 * 1024) throw Error('BUNDLE_LIMIT');
    if (st.isDirectory()) for (const name of await readdir(path)) {
      if (/^(?:\.env.*|\.git|uploads|migrations|credentials)$/i.test(name)) throw Error('UNSAFE_BUNDLE');
      await visit(join(path, name));
    }
  }
  await visit(directory);
  try { if (!(await lstat(join(directory, 'document-renderer-cli.js'))).isFile()) throw Error(); } catch { throw Error('CLI_MISSING'); }
}
/** Operations-only filesystem preparation; never accepts an existing bundle destination. */
export async function createRuntimeBuildContext({ repositoryRoot = ROOT, temporaryParent = tmpdir() } = {}) {
  if (typeof repositoryRoot !== 'string' || !isAbsolute(repositoryRoot) || repositoryRoot.includes('\0')
    || typeof temporaryParent !== 'string' || !isAbsolute(temporaryParent) || temporaryParent.includes('\0')) throw Error('INVALID_BUILD_PATH');
  // AF197 requires both lexical normalization and realpath equality (including macOS /var aliases).
  const canonicalRoot = await realpath(resolve(repositoryRoot));
  const canonicalParent = await realpath(resolve(temporaryParent));
  const fresh = await mkdtemp(join(canonicalParent, 'aij-document-image-'));
  try {
    const context = await realpath(fresh);
    if (context !== fresh) throw Error('BUILD_CONTEXT_CHANGED');
    return { repositoryRoot: canonicalRoot, context, destination: join(context, 'runtime') };
  } catch (primaryError) {
    try { await rm(fresh, { recursive: true, force: true }); }
    catch (cleanupError) { throw new AggregateError([primaryError, cleanupError], 'BUILD_CONTEXT_PREPARATION_FAILED'); }
    throw primaryError;
  }
}
function dockerBuild(cli, context) {
  return new Promise((accept, reject) => {
    let size = 0, failed = false;
    const p = spawn(cli, ['build', '--pull=false', '--network=none', '--iidfile', join(context, 'image-id'), context], {
      cwd: '/', shell: false, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent/aij-document-export-config' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { failed = true; p.kill('SIGKILL'); }, 120000);
    for (const s of [p.stdout, p.stderr]) s.on('data', b => { size += b.length; if (size > 1024 * 1024) { failed = true; p.kill('SIGKILL'); } });
    p.on('error', () => { clearTimeout(timer); reject(Error('IMAGE_BUILD_FAILED')); });
    p.on('close', code => { clearTimeout(timer); if (code === 0 && !failed) accept(); else reject(Error('IMAGE_BUILD_FAILED')); });
  });
}
/** Coordinator/operations only, after I197 CODE_VERIFIED. No service or client entry point. */
export async function buildRuntimeImage({ rootIntegration = false, dockerCliPath, repositoryRoot = ROOT } = {}) {
  if (rootIntegration !== true || !isAbsolute(dockerCliPath ?? '') || resolve(dockerCliPath) !== dockerCliPath || dockerCliPath.includes('\0')) throw Error('ROOT_BUILD_REQUIRED');
  const paths = await createRuntimeBuildContext({ repositoryRoot });
  const { context, destination } = paths;
  let result, primaryError, bundleModule, bundleDirectory;
  const cleanupErrors=[];
  try {
    bundleModule = await import(pathToFileURL(join(paths.repositoryRoot, 'scripts/document-export/runtime-bundle.mjs')));
    const bundle = await bundleModule.buildRuntimeBundle({ destination, repositoryRoot: paths.repositoryRoot });
    bundleDirectory = destination;
    if (bundle.directory !== destination || bundle.fontSha256 !== FONT || bundle.rendererVersion !== 'aij-plain-document-v1') throw Error('BUNDLE_CONTRACT');
    await assertBundleTree(bundle.directory);
    await cp(join(ROOT, 'ops/document-export/Dockerfile'), join(context, 'Dockerfile'));
    await dockerBuild(dockerCliPath, context);
    const imageId = (await readFile(join(context, 'image-id'), 'utf8')).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('INVALID_IMAGE_ID');
    result = { imageId, fontSha256: FONT, rendererVersion: bundle.rendererVersion };
  } catch(error) { primaryError=error; }
  finally {
    // Same module instance owns AF197's in-memory capability; do not re-import a cache-busted copy.
    if (bundleDirectory) {
      try { await bundleModule.removeRuntimeBundle(bundleDirectory); }
      catch(error) { cleanupErrors.push(error); }
    }
    try { await rm(context, { recursive: true, force: true }); }
    catch(error) { cleanupErrors.push(error); }
  }
  // Never delete an image here: a successful or interrupted build may reference an existing cached image.
  if(primaryError || cleanupErrors.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...cleanupErrors],'DOCUMENT_IMAGE_BUILD_OR_CLEANUP_FAILED');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--root-integration') throw Error('ROOT_BUILD_REQUIRED');
    console.log(JSON.stringify(await buildRuntimeImage({ rootIntegration: true, dockerCliPath: process.argv[3] })));
  } catch { console.error('DOCUMENT_IMAGE_BUILD_FAILED'); process.exitCode = 1; }
}
