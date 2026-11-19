import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, chmod, readdir, cp, rm, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { buildRuntimeBundle, removeRuntimeBundle } from '../document-export/runtime-bundle.mjs';

// Root-only genuine Linux CLI/readers. This is not a deployed export API.
assert.equal(process.argv[2], '--root-af197');
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const repo = process.cwd();
const artifact = path.join(repo, '.artifacts/auto-ai-program-20261105/W16');
const readerRecord = JSON.parse(await readFile(path.join(artifact, 'AF-197-reader-image-context.json')));
const readerImage = (await readFile(readerRecord.imageIdFile, 'utf8')).trim();
assert.match(readerImage, /^sha256:[a-f0-9]{64}$/);
const nodeImage = 'docker.io/library/node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20';
const docker = '/usr/local/bin/docker';
const scratch = await mkdtemp('/private/tmp/aij-af197-linux-');
let evidence;
const nonce = randomBytes(16).toString('hex');
const output = path.join(artifact, 'AF-197-linux-' + nonce);
await mkdir(output, { mode: 0o700 });
const bundle = path.join(scratch, 'runtime');
const input = path.join(scratch, 'input'), pages = path.join(scratch, 'pages'), readerFonts = path.join(scratch, 'reader-fonts');
await mkdir(input); await mkdir(pages); await chmod(pages, 0o777); await mkdir(readerFonts);
for (const name of ['NotoSansCJKsc-Regular.otf', 'LICENSE']) {
  const bytes = await readFile(path.join(repo, 'assets/document-fonts', name));
  await writeFile(path.join(readerFonts, name), bytes, { mode: 0o644 });
}
const receipts = [], containers = [];
const hash = b => createHash('sha256').update(b).digest('hex');
function call(args, options = {}) {
  const r = spawnSync(docker, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 9 * 1024 * 1024, ...options });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.status, 0, r.stderr?.slice(0, 3000));
  return r.stdout;
}
async function run(image, args, data, mounts = []) {
  const name = 'aij-af197-' + nonce + '-' + containers.length;
  containers.push({ name, image });
  const stdout = call(['run', '--pull=never', '--rm', '-i', '--name', name,
    '--label', 'io.aij.qa.task=AF-197', '--label', 'io.aij.qa.nonce=' + nonce,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user=65534:65534', '--memory=512m', '--memory-swap=512m', '--pids-limit=64', '--cpus=1',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m,uid=65534,gid=65534',
    '--env', 'HOME=/tmp/aij-qa', '--env', 'XDG_CACHE_HOME=/tmp/aij-cache', ...mounts, image, ...args], { input: data, timeout: 90000 });
  assert.equal(call(['container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$']).trim(), '');
  return stdout;
}
const sample = {
  name: '中文文档 Title & <测试>',
  body: '第一行：中文、English & <xml>\r\n\r\n制表\t后文\n' + '长无空格中文'.repeat(80) + '\n' +
    Array.from({ length: 80 }, (_, i) => `第${String(i).padStart(3, '0')}行：中文分页 English`).join('\n') + '\n末尾 END',
};
let built = false;
const cleanupErrors = [];
try {
  await buildRuntimeBundle({ destination: bundle, repositoryRoot: repo }); built = true;
  await chmod(bundle, 0o755); // Own public-code directory, no credentials.
  const inventory = JSON.parse(await readFile(path.join(bundle, 'dependency-inventory.json')));
  assert.ok(inventory.packages.length > 2);
  assert.ok(!inventory.packages.some(p => ['typescript', 'pdfjs-dist', '@nestjs/core', '@prisma/client'].includes(p.name)));
  for (const format of ['pdf', 'docx']) {
    const text = await run(nodeImage, ['/usr/local/bin/node', '/aij/document-renderer-cli.js'], JSON.stringify({ input: { ...sample, format } }), ['--mount', `type=bind,src=${bundle},dst=/aij,readonly`]);
    assert.equal(text.trim().split('\n').length, 1);
    const result = JSON.parse(text);
    assert.deepEqual(Object.keys(result).sort(), ['schemaVersion', 'format', 'mimeType', 'size', 'sha256', 'pageCount', 'rendererVersion', 'base64'].sort());
    assert.equal(result.schemaVersion, 1); assert.equal(result.format, format);
    assert.equal(result.rendererVersion, 'aij-plain-document-v1');
    assert.equal(result.mimeType, format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const bytes = Buffer.from(result.base64, 'base64');
    assert.equal(bytes.toString('base64'), result.base64);
    assert.equal(bytes.length, result.size); assert.equal(hash(bytes), result.sha256);
    assert.ok(bytes.length > 1000 && bytes.length <= 5 * 1024 * 1024);
    if (format === 'pdf') assert.ok(result.pageCount >= 2 && result.pageCount <= 100);
    else assert.equal(result.pageCount, null);
    await writeFile(path.join(input, 'sample.' + format), bytes);
    const metadata = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'base64'));
    receipts.push(metadata);
  }
  // The CLI must reject in Linux too; fixed errors, no user body/path/stack.
  const name = 'aij-af197-' + nonce + '-invalid'; containers.push({ name, image: nodeImage });
  const invalid = spawnSync(docker, ['run', '--pull=never', '--rm', '-i', '--name', name, '--label', 'io.aij.qa.nonce=' + nonce,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534',
    '--memory=512m', '--memory-swap=512m', '--pids-limit=64', '--cpus=1', '--mount', `type=bind,src=${bundle},dst=/aij,readonly`,
    nodeImage, '/usr/local/bin/node', '/aij/document-renderer-cli.js'], { input: '{"input":null}', encoding: 'utf8', timeout: 45000 });
  assert.equal(invalid.error, undefined); assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ''); assert.equal(invalid.stderr, 'INVALID_INPUT\n');
  assert.equal(call(['container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$']).trim(), '');
  const reader = `import subprocess,pathlib,json,zipfile,xml.etree.ElementTree as E
p=pathlib.Path('/output'); p.mkdir(exist_ok=True)
def run(args):
 r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
 assert r.returncode==0,(args[0],r.stderr.decode()[:2000])
 return r.stdout.decode()
assert 'NotoSansCJKsc' in run(['/usr/bin/fc-match','Noto Sans CJK SC'])
with zipfile.ZipFile('/input/sample.docx') as z:
 assert z.testzip() is None
 for n in z.namelist():
  assert not ('vba' in n.lower() or n.startswith('/') or '..' in n.split('/'))
  if n.endswith('.xml') or n.endswith('.rels'): E.fromstring(z.read(n))
  if n.endswith('.rels'): assert all(x.get('TargetMode')!='External' for x in E.fromstring(z.read(n)))
 x=E.fromstring(z.read('word/document.xml')); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 assert len(x.findall('.//w:r/w:tab',ns))==1
 assert x.findall('.//w:rFonts',ns)[0].get('{'+ns['w']+'}eastAsia')=='Noto Sans CJK SC'
 assert '末尾 END' in ''.join(x.itertext())
run(['/usr/bin/soffice','-env:UserInstallation=file:///tmp/aij-lo-profile','--headless','--convert-to','pdf','--outdir','/output','/input/sample.docx'])
assert (p/'sample.pdf').is_file()
reports=[]
for name,source in [('pdf','/input/sample.pdf'),('word','/output/sample.pdf')]:
 info=run(['/usr/bin/pdfinfo',source]); text=run(['/usr/bin/pdftotext','-layout',source,'-']); fonts=run(['/usr/bin/pdffonts',source])
 (p/(name+'.txt')).write_text(text); (p/(name+'-info.txt')).write_text(info); (p/(name+'-fonts.txt')).write_text(fonts)
 compact=''.join(text.split())
 assert '中文文档' in compact and '第079行' in compact and '末尾END' in compact,(name,repr(text[:100]),repr(text[-150:]))
 assert '长无空格中文'*2 in ''.join(text.split())
 assert 'NotoSansCJKsc' in fonts.replace('-','')
 pages=int(next(l.split(':')[1].strip() for l in info.splitlines() if l.startswith('Pages:')))
 assert 2<=pages<=100
 run(['/usr/bin/pdftoppm','-r','60','-png',source,'/output/'+name])
 assert len(list(p.glob(name+'-*.png')))==pages
 (p/(name+'.txt')).write_text(text); (p/(name+'-info.txt')).write_text(info); (p/(name+'-fonts.txt')).write_text(fonts)
 reports.append({'format':name,'pages':pages,'textEnd':True,'font':True})
print(json.dumps({'readers':'LibreOffice+Poppler','reports':reports}))
`;
  await writeFile(path.join(input, 'read.py'), reader);
  const readerResult = JSON.parse(await run(readerImage, ['/usr/bin/python3', '/input/read.py'], '', [
    '--mount', `type=bind,src=${input},dst=/input,readonly`, '--mount', `type=bind,src=${pages},dst=/output`,
    '--mount', `type=bind,src=${readerFonts},dst=/usr/local/share/fonts/aij,readonly`,
  ]));
  const pngs = (await readdir(pages)).filter(p => p.endsWith('.png')).sort();
  assert.ok(pngs.length >= 4);
  await cp(input, path.join(output, 'input'), { recursive: true });
  await cp(pages, path.join(output, 'pages'), { recursive: true });
  evidence = { status: 'PASS', task: 'AF-197', nonce, nodeImage, readerImage, receipts,
    readerResult, pngs, containersStarted: containers.length, containersRemaining: 0,
    visualReview: 'PENDING', scope: 'bounded internal renderer only; no export API/attachment/SDK/frontend/vendor acceptance', output };
} finally {
  // Preserve reader diagnostics and exact synthetic files even after a failed assertion.
  await cp(input, path.join(output, 'input'), { recursive: true });
  await cp(pages, path.join(output, 'pages'), { recursive: true });
  for (const own of containers) {
    try {
      const ids = call(['container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + own.name + '$']).trim();
      if (ids) {
        assert.match(ids, /^[a-f0-9]{64}$/);
        const [inspected] = JSON.parse(call(['container', 'inspect', ids]));
        assert.equal(inspected.Name, '/' + own.name); assert.equal(inspected.Config.Labels['io.aij.qa.nonce'], nonce);
        assert.equal(inspected.Config.Image, own.image);
        call(['container', 'rm', '-f', ids]);
      }
      assert.equal(call(['container', 'ls', '-aq', '--no-trunc', '--filter', 'name=^/' + own.name + '$']).trim(), '');
    } catch (e) { cleanupErrors.push(e); }
  }
  if (built) { try { await removeRuntimeBundle(bundle); await assert.rejects(lstat(bundle), { code: 'ENOENT' }); } catch (e) { cleanupErrors.push(e); } }
  if (cleanupErrors.length === 0) await rm(scratch, { recursive: true });
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'AF197_OWNED_RESOURCE_CLEANUP_FAILED');

evidence.bundleRemoved = true;
await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(path.join(artifact, 'AF-197-linux-latest.json'), JSON.stringify({ output }, null, 2) + '\n');
console.log(JSON.stringify(evidence));
