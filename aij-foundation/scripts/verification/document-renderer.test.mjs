import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile, symlink, lstat, realpath, cp, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRuntimeBundle, removeRuntimeBundle } from '../document-export/runtime-bundle.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
const deps = await realpath(process.env.AF197_TEST_DEPENDENCY_ROOT ?? repo);
const req = createRequire(path.join(deps, 'package.json'));
const ts = req('typescript');
// Independent PDF parser: test-only dependency, never included in the runtime bundle.
const pdfjs = await import(pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const scratch = await mkdtemp(path.join(deps, 'af197-test-'));
const compiled = path.join(scratch, 'apps/api/dist/documents');
await mkdir(compiled, { recursive: true });
await writeFile(path.join(scratch, 'apps/api/package.json'), '{}');
for (const name of ['document-renderer', 'document-renderer-cli']) {
  const source = await readFile(path.join(repo, 'apps/api/src/documents', name + '.ts'), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  await writeFile(path.join(compiled, name + '.js'), result.outputText);
}
const { renderPlainDocument, DOCUMENT_FONT_SHA256 } = req(path.join(compiled, 'document-renderer.js'));
const fontPath = process.env.AF197_TEST_FONT_PATH ?? path.join(repo, 'assets/document-fonts/NotoSansCJKsc-Regular.otf');
const licensePath = process.env.AF197_TEST_FONT_LICENSE_PATH ?? path.join(repo, 'assets/document-fonts/LICENSE');
const options = { fontPath, fontSha256: DOCUMENT_FONT_SHA256 };
const input = { format: 'pdf', name: '中文文档 Title & <测试>', body: '第一行：中文、English & <xml>\r\n\r\n制表\t后文\n' + '长无空格中文'.repeat(120) + '\n末尾 END' };
const hash = b => createHash('sha256').update(b).digest('hex');
async function parsePdf(bytes) {
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, isEvalSupported: false });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      pages.push((await page.getTextContent()).items.filter(x => 'str' in x).map(x => x.str).join(''));
    }
    return { count: doc.numPages, pages };
  } finally { await task.destroy(); }
}
try {
  await test('real PDF: Chinese text, wrapping, page tree, font embedding, checksum', async () => {
    const result = await renderPlainDocument(input, options);
    assert.equal(result.size, result.bytes.length); assert.equal(result.sha256, hash(result.bytes));
    const parsed = await parsePdf(result.bytes);
    assert.equal(parsed.count, result.pageCount); assert.ok(parsed.count >= 1);
    const text = parsed.pages.join(''); assert.ok(text.includes('中文文档')); assert.ok(text.includes('末尾 END')); assert.ok(text.includes('<xml>'));
    assert.equal((text.match(/长无空格中文/g) ?? []).length, 120);
    assert.match(result.bytes.toString('latin1'), /\/FontFile3\b/);
  });
  await test('real DOCX: independent ZIP CRC/XML/content/relationships inspection', async () => {
    const result = await renderPlainDocument({ ...input, format: 'docx' }, options);
    assert.equal(result.pageCount, null); assert.equal(result.sha256, hash(result.bytes));
    const file = path.join(scratch, 'sample.docx'); await writeFile(file, result.bytes);
    const inspected = spawnSync('python3', ['-c', `import sys,zipfile,xml.etree.ElementTree as E,json
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert '[Content_Types].xml' in z.namelist()
 for n in z.namelist():
  assert not ('vba' in n.lower() or n.startswith('/') or '..' in n.split('/'))
  if n.endswith('.xml') or n.endswith('.rels'): E.fromstring(z.read(n))
 ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 d=E.fromstring(z.read('word/document.xml'))
 p=d.findall('.//w:body/w:p',ns)
 assert len(p)==6
 assert len(d.findall('.//w:r/w:tab',ns))==1
 assert d.findall('.//w:rFonts',ns)[0].get('{'+ns['w']+'}eastAsia')=='Noto Sans CJK SC'
 for n in z.namelist():
  if n.endswith('.rels'):
   assert all(x.get('TargetMode')!='External' for x in E.fromstring(z.read(n)))
 print(json.dumps([''.join(x.itertext()) for x in p],ensure_ascii=False))`, file], { encoding: 'utf8' });
    assert.equal(inspected.status, 0, inspected.stderr);
    const paragraphs = JSON.parse(inspected.stdout);
    assert.equal(paragraphs[0], input.name); assert.equal(paragraphs[2], '');
    assert.ok(paragraphs.join('').includes('<xml>')); assert.equal(paragraphs.at(-1), '末尾 END');
  });
  await test('multi-page PDF has actual pages and end content', async () => {
    const result = await renderPlainDocument({ format: 'pdf', name: '分页', body: Array.from({ length: 160 }, (_, i) => `第${i}行中文内容`).join('\n') }, options);
    const parsed = await parsePdf(result.bytes); assert.ok(parsed.count >= 3); assert.equal(parsed.count, result.pageCount); assert.ok(parsed.pages.at(-1).includes('第159行'));
  });
  await test('bounded input and fixed safe errors, including accessors and unsupported glyph', async () => {
    const cases = [null, { ...input, format: 'html' }, { ...input, extra: 1 }, { ...input, name: ' ' }, { ...input, name: 'x'.repeat(161) }, { ...input, body: '\u0000' }, { ...input, body: '\ud800' }, { ...input, body: '中'.repeat(21846) }, { ...input, body: '\n'.repeat(2048) }];
    for (const value of cases) await assert.rejects(renderPlainDocument(value, options), { message: 'INVALID_INPUT' });
    const getter = { ...input }; Object.defineProperty(getter, 'body', { get() { throw new Error('SECRET'); } });
    await assert.rejects(renderPlainDocument(getter, options), { message: 'INVALID_INPUT' });
    for (const format of ['pdf', 'docx']) await assert.rejects(renderPlainDocument({ ...input, format, body: '\u{10FFFF}' }, options), { message: 'UNSUPPORTED_GLYPH' });
    await assert.rejects(renderPlainDocument(input, { ...options, fontPath: '/missing/private/SECRET' }), { message: 'FONT_UNAVAILABLE' });
    await assert.rejects(renderPlainDocument(input, { ...options, fontSha256: 'bad' }), { message: 'FONT_MISMATCH' });
    const bad = path.join(scratch, 'badfont'); await writeFile(bad, 'bad');
    await assert.rejects(renderPlainDocument(input, { ...options, fontPath: bad }), { message: 'FONT_MISMATCH' });
    const tampered = await readFile(fontPath); tampered[0] ^= 1; await writeFile(bad, tampered);
    await assert.rejects(renderPlainDocument(input, { ...options, fontPath: bad }), { message: 'FONT_MISMATCH' });
    const bounded = await renderPlainDocument({ ...input, body: '\n'.repeat(2047) }, options);
    assert.ok(bounded.pageCount > 40 && bounded.pageCount <= 100); assert.ok(bounded.size <= 5 * 1024 * 1024);
  });
  await test('CLI rejects malformed, oversized and invalid UTF8 input with no body or stack', () => {
    for (const data of ['{"input":null}', 'SECRET', 'x'.repeat(81921), Buffer.from([0xff])]) {
      const child = spawnSync(process.execPath, [path.join(compiled, 'document-renderer-cli.js')], { input: data, encoding: 'utf8' });
      assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.equal(child.stderr, 'INVALID_INPUT\n');
    }
  });
  await test('forged marker without a builder capability cannot authorize deletion', async () => {
    const forged = path.join(scratch, 'forged-runtime');
    await mkdir(forged);
    const marker = JSON.stringify({ schemaVersion: 1, rendererVersion: 'aij-plain-document-v1', directory: forged, nonce: randomUUID() });
    await writeFile(path.join(forged, '.aij-document-runtime.json'), marker);
    await writeFile(path.join(forged, 'sentinel.txt'), 'must survive unauthorized cleanup');
    await assert.rejects(removeRuntimeBundle(forged), { message: 'INVALID_RUNTIME_BUNDLE' });
    assert.equal(await readFile(path.join(forged, '.aij-document-runtime.json'), 'utf8'), marker);
    assert.equal(await readFile(path.join(forged, 'sentinel.txt'), 'utf8'), 'must survive unauthorized cleanup');
  });
  await test('offline runtime closure, standalone real render, fresh destination and cleanup fences', async () => {
    const assets = path.join(scratch, 'assets/document-fonts'); await mkdir(assets, { recursive: true });
    await copyFile(fontPath, path.join(assets, 'NotoSansCJKsc-Regular.otf')); await copyFile(licensePath, path.join(assets, 'LICENSE'));
    // Provision only the real private runtime closure inside the fake repository.
    async function provision(name, from, target) {
      const resolver = createRequire(from);
      let entry; try { entry = resolver.resolve(name + '/package.json'); } catch { entry = resolver.resolve(name); }
      let dir = path.dirname(entry);
      while (JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8').catch(() => '{}')).name !== name) dir = path.dirname(dir);
      const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      await cp(dir, target, { recursive: true, filter: src => !path.relative(dir, src).split(path.sep).includes('node_modules') });
      for (const dep of Object.keys(manifest.dependencies ?? {})) await provision(dep, path.join(dir, 'package.json'), path.join(target, 'node_modules', dep));
    }
    for (const name of ['docx', 'pdfkit']) await provision(name, path.join(deps, 'package.json'), path.join(scratch, 'node_modules', name));
    const destination = path.join(scratch, 'runtime');
    const bundle = await buildRuntimeBundle({ destination, repositoryRoot: scratch });
    assert.equal(bundle.fontSha256, DOCUMENT_FONT_SHA256);
    const standalone = req(path.join(destination, 'document-renderer.js'));
    const rendered = await standalone.renderPlainDocument({ format: 'pdf', name: '闭包', body: '真实独立依赖' }, { fontPath: path.join(destination, 'assets/document-fonts/NotoSansCJKsc-Regular.otf'), fontSha256: bundle.fontSha256 });
    assert.ok((await parsePdf(rendered.bytes)).pages.join('').includes('真实独立依赖'));
    const inventory = JSON.parse(await readFile(path.join(destination, 'dependency-inventory.json'), 'utf8'));
    for (const pkg of inventory.packages) {
      const at = path.join(destination, pkg.directory, 'package.json');
      const resolver = createRequire(at);
      const manifest = JSON.parse(await readFile(at, 'utf8'));
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        let resolved; try { resolved = resolver.resolve(name + '/package.json'); } catch { resolved = resolver.resolve(name); }
        assert.ok(resolved.startsWith(destination + path.sep), 'dependency must resolve inside bundle');
      }
    }
    assert.ok(inventory.packages.some(p => p.name === 'fontkit')); assert.ok(inventory.packages.some(p => p.name === 'docx' && p.version === '9.15.2')); assert.ok(!inventory.packages.some(p => p.name === 'typescript' || p.name === 'pdfjs-dist'));
    await assert.rejects(buildRuntimeBundle({ destination, repositoryRoot: scratch }), { message: 'INVALID_RUNTIME_BUNDLE' });
    await assert.rejects(removeRuntimeBundle(scratch), { message: 'INVALID_RUNTIME_BUNDLE' });
    const link = path.join(scratch, 'linked'); await symlink(destination, link);
    await assert.rejects(removeRuntimeBundle(link), { message: 'INVALID_RUNTIME_BUNDLE' });
    // A copied valid nonce cannot authorize deletion of a replacement inode.
    const held = path.join(scratch, 'held-runtime');
    const validMarker = await readFile(path.join(destination, '.aij-document-runtime.json'));
    await rename(destination, held);
    await mkdir(destination);
    await writeFile(path.join(destination, '.aij-document-runtime.json'), validMarker);
    await writeFile(path.join(destination, 'sentinel.txt'), 'replacement must survive');
    await assert.rejects(removeRuntimeBundle(destination), { message: 'INVALID_RUNTIME_BUNDLE' });
    assert.equal(await readFile(path.join(destination, 'sentinel.txt'), 'utf8'), 'replacement must survive');
    await rm(destination, { recursive: true }); // Test owns the replacement fixture.
    await rename(held, destination);
    await removeRuntimeBundle(destination); await assert.rejects(lstat(destination), { code: 'ENOENT' });
    await rm(link);
    // Failure after mkdir must clean only this builder's incomplete directory.
    const unsafeLink = path.join(scratch, 'node_modules/docx/unsafe-link');
    await symlink(path.join(assets, 'LICENSE'), unsafeLink);
    await assert.rejects(buildRuntimeBundle({ destination, repositoryRoot: scratch }), { message: 'INVALID_RUNTIME_BUNDLE' });
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
    await assert.rejects(removeRuntimeBundle(destination), { message: 'INVALID_RUNTIME_BUNDLE' });
    await rm(unsafeLink);
    await writeFile(path.join(assets, 'LICENSE'), 'tampered');
    await assert.rejects(buildRuntimeBundle({ destination, repositoryRoot: scratch }), { message: 'INVALID_RUNTIME_BUNDLE' });
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
  });
} finally { await rm(scratch, { recursive: true, force: true }); }
