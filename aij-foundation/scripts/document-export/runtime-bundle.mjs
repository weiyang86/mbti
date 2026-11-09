import { constants } from 'node:fs';
import { lstat, realpath, readFile, readdir, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const VERSION = 'aij-plain-document-v1';
const FONT = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b';
const LICENSE = '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2';
const MARKER = '.aij-document-runtime.json';
// Only this module instance can mint a cleanup capability after its own mkdir.
// On-disk markers are integrity checks, never ownership credentials.
const ownership = new Map();
const hash = b => createHash('sha256').update(b).digest('hex');
function reject() { throw new Error('INVALID_RUNTIME_BUNDLE'); }
async function regular(file) { const s = await lstat(file); if (!s.isFile() || s.isSymbolicLink()) reject(); return s; }
async function canonical(directory) { if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || await realpath(directory) !== directory) reject(); }
async function packageRoot(name, from) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) reject();
  const req = createRequire(from);
  let file;
  try { file = req.resolve(`${name}/package.json`); } catch { file = req.resolve(name); }
  let current = path.dirname(await realpath(file));
  for (;;) {
    try { const manifest = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8')); if (manifest.name === name) return { directory: current, manifest }; } catch { /* ascend to owning package */ }
    const parent = path.dirname(current); if (parent === current) reject(); current = parent;
  }
}

/** Offline, fresh-directory-only closure. No install, subprocess, network, or whole node_modules copy. */
export async function buildRuntimeBundle({ destination, repositoryRoot }) {
  let capability;
  const nonce = randomUUID();
  try {
    await canonical(repositoryRoot);
    if (!path.isAbsolute(destination) || path.resolve(destination) !== destination || destination === repositoryRoot || repositoryRoot.startsWith(destination + path.sep)) reject();
    await canonical(path.dirname(destination));
    try { await lstat(destination); reject(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const api = path.join(repositoryRoot, 'apps/api');
    const compiled = path.join(api, 'dist/documents');
    const compiledFiles = ['document-renderer.js', 'document-renderer-cli.js'];
    for (const name of compiledFiles) {
      const file = path.join(compiled, name); await regular(file);
      if (await realpath(file) !== file) reject();
      const code = await readFile(file, 'utf8');
      // Compiled entry closure may import only these explicit modules, never app/DB owners.
      const allowed = new Set(['docx', 'pdfkit', './document-renderer', 'node:crypto', 'node:fs/promises', 'node:fs', 'node:util']);
      for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) if (!allowed.has(match[1])) reject();
      if (/\bimport\s*\(|\beval\s*\(/.test(code)) reject();
    }
    const assets = path.join(repositoryRoot, 'assets/document-fonts');
    for (const [name, expected] of [['NotoSansCJKsc-Regular.otf', FONT], ['LICENSE', LICENSE]]) {
      const file = path.join(assets, name); await regular(file); if (await realpath(file) !== file || hash(await readFile(file)) !== expected) reject();
    }
    const roots = [];
    for (const [name, version] of [['docx', '9.15.2'], ['pdfkit', '0.20.2']]) {
      const pkg = await packageRoot(name, path.join(api, 'package.json'));
      if (pkg.manifest.version !== version || !pkg.directory.startsWith(repositoryRoot + path.sep)) reject(); roots.push(pkg);
    }
    await mkdir(destination, { mode: 0o700 });
    const identity = await lstat(destination, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) reject();
    capability = { nonce, dev: identity.dev, ino: identity.ino, ready: false };
    ownership.set(destination, capability);
    await writeFile(path.join(destination, MARKER), JSON.stringify({ schemaVersion: 1, rendererVersion: VERSION, directory: destination, nonce }), { flag: 'wx', mode: 0o600 });
    let bytes = 0, files = 0, packages = 0;
    const inventory = [];
    async function copyTree(source, target) {
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(source, { withFileTypes: true })) {
        if (['node_modules', '.git'].includes(entry.name)) continue;
        if (entry.name.startsWith('.env') || entry.isSymbolicLink()) reject();
        const src = path.join(source, entry.name), dst = path.join(target, entry.name);
        if (entry.isDirectory()) await copyTree(src, dst);
        else {
          const s = await regular(src); bytes += s.size; files++;
          if (bytes > 256 * 1024 * 1024 || files > 20000) reject();
          await copyFile(src, dst, constants.COPYFILE_EXCL);
        }
      }
    }
    async function copyPackage(pkg, target, ancestors = []) {
      if (++packages > 512 || ancestors.includes(pkg.directory) || !pkg.directory.startsWith(repositoryRoot + path.sep) || !pkg.directory.includes(path.sep + 'node_modules' + path.sep)) reject();
      await copyTree(pkg.directory, target);
      inventory.push({ name: pkg.manifest.name, version: pkg.manifest.version, directory: path.relative(destination, target) });
      const deps = { ...pkg.manifest.dependencies, ...pkg.manifest.optionalDependencies };
      for (const name of Object.keys(deps).sort()) {
        let child;
        try { child = await packageRoot(name, path.join(pkg.directory, 'package.json')); }
        catch (e) { if (Object.hasOwn(pkg.manifest.optionalDependencies ?? {}, name)) continue; throw e; }
        await copyPackage(child, path.join(target, 'node_modules', name), [...ancestors, pkg.directory]);
      }
    }
    for (const pkg of roots) await copyPackage(pkg, path.join(destination, 'node_modules', pkg.manifest.name));
    for (const name of compiledFiles) await copyFile(path.join(compiled, name), path.join(destination, name), constants.COPYFILE_EXCL);
    await mkdir(path.join(destination, 'assets/document-fonts'), { recursive: true });
    for (const name of ['NotoSansCJKsc-Regular.otf', 'LICENSE']) await copyFile(path.join(assets, name), path.join(destination, 'assets/document-fonts', name), constants.COPYFILE_EXCL);
    await writeFile(path.join(destination, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }), { flag: 'wx' });
    await writeFile(path.join(destination, 'dependency-inventory.json'), JSON.stringify({ schemaVersion: 1, rendererVersion: VERSION, packages: inventory }), { flag: 'wx' });
    capability.ready = true;
    return { directory: destination, fontSha256: FONT, rendererVersion: VERSION };
  } catch {
    if (capability) {
      // Private capability also permits cleanup of our incomplete build before
      // the marker exists; never consult a marker to acquire ownership.
      try { await removeOwnedDirectory(destination, capability, false); } catch { /* fail closed */ }
    }
    reject();
  }
}

async function removeOwnedDirectory(directory, capability, requireReady) {
  if (!capability || ownership.get(directory) !== capability || requireReady && !capability.ready) reject();
  await canonical(directory);
  if (requireReady) {
    const file = path.join(directory, MARKER); await regular(file);
    const marker = JSON.parse(await readFile(file, 'utf8'));
    if (marker.schemaVersion !== 1 || marker.rendererVersion !== VERSION || marker.directory !== directory || marker.nonce !== capability.nonce) reject();
  }
  const identity = await lstat(directory, { bigint: true });
  if (!identity.isDirectory() || identity.isSymbolicLink() || identity.dev !== capability.dev || identity.ino !== capability.ino) reject();
  // Claim once, after the final awaited validation. Concurrent calls and a
  // recreated directory at the same path cannot reuse this capability.
  if (ownership.get(directory) !== capability) reject();
  ownership.delete(directory);
  await rm(directory, { recursive: true });
}

export async function removeRuntimeBundle(directory) {
  try { await removeOwnedDirectory(directory, ownership.get(directory), true); }
  catch { reject(); }
}
