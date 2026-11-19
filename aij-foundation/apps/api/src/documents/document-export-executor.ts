import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';

const IMAGE = /^sha256:[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{64}$/;
const NONCE_LABEL = 'io.aij.document-export.nonce';
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const CONTROL_LIMIT = 16 * 1024;
const CONTROL_MS = 5_000;
const INSPECT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"nonce":{{json (index .Config.Labels "io.aij.document-export.nonce")}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}}}';
// Ownership/control lifecycle adapted from PythonSandboxRunner at source 45042c1; original owner unchanged.
const FILE_LIMIT = 5 * 1024 * 1024;
const VERSION = 'aij-plain-document-v1';
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' } as const;
export type DocumentExportOutcome = 'SUCCESS' | 'DISABLED' | 'INVALID_CONFIGURATION' | 'INVALID_INPUT'
  | 'BUSY' | 'ABORTED' | 'TIMEOUT' | 'OUTPUT_LIMIT' | 'INVALID_PROTOCOL' | 'IMAGE_UNAVAILABLE'
  | 'EXECUTION_FAILED' | 'RENDERER_REJECTED' | 'OOM_KILLED' | 'CLEANUP_UNCONFIRMED';
export interface DocumentExportArtifact {
  format: 'docx' | 'pdf'; mimeType: string; bytes: Buffer; size: number; sha256: string;
  pageCount: number | null; rendererVersion: 'aij-plain-document-v1';
}
export interface DocumentExportResult { outcome: DocumentExportOutcome; cleanupConfirmed: boolean; artifact?: DocumentExportArtifact; }
/** Administrator-only immutable construction. Never bind options to request DTOs or environment switches. */
export interface DocumentExportOptions { enabled?: boolean; dockerCliPath?: string; approvedImage?: string; }
export interface DocumentExportRequest { input: unknown; timeoutMs?: number; signal?: AbortSignal; }
interface ProcessResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  closed: boolean;
  fault?: 'TIMEOUT' | 'ABORTED' | 'OUTPUT_LIMIT' | 'EXECUTION_FAILED';
}
interface OwnedContainer {
  id: string; name: string; image: string; imageId: string; nonce: string;
  state: string; exitCode: number; oomKilled: boolean;
}
const safeResult = (outcome: DocumentExportOutcome, cleanupConfirmed = true): DocumentExportResult => ({ outcome, cleanupConfirmed });
function parseInput(request: DocumentExportRequest): { protocol: string; format: 'docx' | 'pdf' } {
  if (!request || typeof request !== 'object' || !request.input || typeof request.input !== 'object') throw Error('input');
  const input = request.input as Record<string, unknown>;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).some(k => typeof k !== 'string' || !Object.getOwnPropertyDescriptor(input, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, k)!, 'value'))
    || Object.keys(input).sort().join(',') !== 'body,format,name' || (input.format !== 'docx' && input.format !== 'pdf')
    || typeof input.name !== 'string' || typeof input.body !== 'string'
    || input.name !== input.name.trim() || !/[^\p{White_Space}\p{Cf}\p{M}]/u.test(input.name) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input.name)
    || Array.from(input.name).length < 1 || Array.from(input.name).length > 160
    || Buffer.byteLength(input.body) > 65536 || input.body.split(/\r\n|\r|\n/).length > 2048
    || [input.name, input.body].some(t => Buffer.from(t).toString('utf8') !== t || Array.from(t).some(c => { const n = c.codePointAt(0)!; return n < 32 && ![9, 10, 13].includes(n) || n >= 127 && n <= 159; }))
    || (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 15000))) throw Error('input');
  const protocol = JSON.stringify({ input: { format: input.format, name: input.name, body: input.body } }) + '\n';
  if (Buffer.byteLength(protocol) > 80 * 1024) throw Error('input');
  return { protocol, format: input.format };
}
/** A bounded single line, exact canonical envelope; duplicate/unknown keys and noncanonical base64 are rejected. */
function parseOutput(stdout: Buffer, format: 'docx' | 'pdf'): DocumentExportArtifact {
  const line = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  if (!line.endsWith('\n') || line.slice(0, -1).includes('\n') || line.includes('\r')) throw Error('protocol');
  const p = JSON.parse(line);
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== 'base64,format,mimeType,pageCount,rendererVersion,schemaVersion,sha256,size'
    || p.schemaVersion !== 1 || p.format !== format || p.mimeType !== MIME[format] || p.rendererVersion !== VERSION
    || !Number.isInteger(p.size) || p.size < 1 || p.size > FILE_LIMIT || !/^[a-f0-9]{64}$/.test(p.sha256)
    || (format === 'pdf' ? !Number.isInteger(p.pageCount) || p.pageCount < 1 || p.pageCount > 100 : p.pageCount !== null)
    || typeof p.base64 !== 'string' || p.base64.length > 4 * Math.ceil(FILE_LIMIT / 3)
    || p.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.base64)) throw Error('protocol');
  // Count key occurrences lexically, including escaped keys, to reject JSON duplicate keys.
  const keys = [...line.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(m => JSON.parse(m[1]));
  if (keys.length !== 8 || new Set(keys).size !== 8) throw Error('protocol');
  const bytes = Buffer.from(p.base64, 'base64');
  if (bytes.toString('base64') !== p.base64 || bytes.length !== p.size || createHash('sha256').update(bytes).digest('hex') !== p.sha256
    || (format === 'pdf' ? !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) : !bytes.subarray(0, 4).equals(Buffer.from([80,75,3,4])))) throw Error('protocol');
  return { format, mimeType: p.mimeType, bytes, size: p.size, sha256: p.sha256, pageCount: p.pageCount, rendererVersion: VERSION };
}

/** Local Docker engine adapter. No host interpreter, mounts, shell, pull, or caller CLI options. */
export class DocumentExportExecutor {
  private static active = 0;
  private static quarantined = false;
  private readonly options: Readonly<DocumentExportOptions>;
  constructor(options: DocumentExportOptions = {}) { this.options = Object.freeze({ ...options }); }

  private process(args: string[], stdin = '', timeoutMs = CONTROL_MS, signal?: AbortSignal, limit = CONTROL_LIMIT): Promise<ProcessResult> {
    return new Promise(resolve => {
      const chunks: Buffer[][] = [[], []];
      const sizes = [0, 0];
      let fault: ProcessResult['fault'];
      let done = false;
      let reapTimer: NodeJS.Timeout | undefined;
      // No inherited HOME, Docker context/endpoint/config, credentials, proxy or application env.
      const child = spawn(this.options.dockerCliPath!, args, {
        shell: false, windowsHide: true, cwd: '/',
        env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent/aij-document-export-docker-config', LANG: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const finish = (code: number | null, closed = true): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (reapTimer) clearTimeout(reapTimer);
        signal?.removeEventListener('abort', abort);
        resolve({ code, stdout: Buffer.concat(chunks[0]), stderr: Buffer.concat(chunks[1]), closed, fault });
      };
      const stop = (reason: ProcessResult['fault']): void => {
        if (done || fault) return;
        fault = reason;
        child.kill('SIGKILL');
        // CLI exit is NOT container cancellation. The caller always performs ownership-checked cleanup.
        reapTimer = setTimeout(() => { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); finish(null, false); }, 500);
      };
      const abort = (): void => stop('ABORTED');
      const timer = setTimeout(() => stop('TIMEOUT'), Math.max(1, timeoutMs));
      child.on('error', () => { fault = 'EXECUTION_FAILED'; finish(null); });
      child.on('close', code => finish(code));
      child.stdin.on('error', () => { /* EPIPE is resolved by close and container state inspection. */ });
      for (const [index, stream] of [child.stdout, child.stderr].entries()) {
        stream.on('data', (data: Buffer) => {
          const streamLimit = index === 1 ? CONTROL_LIMIT : limit;
          const remaining = streamLimit - sizes[index];
          if (remaining > 0) chunks[index].push(data.subarray(0, remaining));
          sizes[index] += data.length;
          if (sizes[index] > streamLimit) stop('OUTPUT_LIMIT');
        });
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stdin.end(stdin);
    });
  }

  private async inspect(target: string): Promise<OwnedContainer | 'absent' | 'unknown'> {
    const result = await this.process(['container', 'inspect', '--format', INSPECT, target]);
    if (result.fault) return 'unknown';
    // A generic exit 1 can mean a disconnected daemon: only exact missing-container diagnostics prove absence.
    if (result.code !== 0) {
      const error = result.stderr.toString('utf8').trim();
      const output = result.stdout.toString('utf8').trim();
      // Docker --format can emit a newline (or an empty JSON array) on exact missing-object errors.
      return result.code === 1 && (output === '' || output === '[]') && [
        `Error: No such container: ${target}`, `Error: No such object: ${target}`,
        `Error response from daemon: No such container: ${target}`,
      ].includes(error) ? 'absent' : 'unknown';
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)) as OwnedContainer; }
    catch { return 'unknown'; }
  }

  private owned(info: OwnedContainer | string, name: string, nonce: string, imageId: string, expectedId?: string): info is OwnedContainer {
    return typeof info === 'object' && info !== null && typeof info.id === 'string' && info.id.length === 64 && ID.test(info.id) && (!expectedId || info.id === expectedId)
      && info.name === `/${name}` && info.nonce === nonce && info.image === this.options.approvedImage
      && info.imageId === imageId && ['created', 'running', 'paused', 'restarting', 'exited', 'dead'].includes(info.state)
      && Number.isInteger(info.exitCode) && typeof info.oomKilled === 'boolean';
  }

  private async cleanup(name: string, nonce: string, imageId: string, expectedId?: string, createUncertain = false): Promise<boolean> {
    let info = await this.inspect(name);
    if (info === 'absent') return !createUncertain && (!expectedId || await this.inspect(expectedId) === 'absent');
    if (!this.owned(info, name, nonce, imageId, expectedId)) return false;
    const id = info.id;
    if (['running', 'paused', 'restarting'].includes(info.state)) {
      // This inspect immediately authorizes this one kill, of this full ID only.
      await this.process(['container', 'kill', '--signal', 'KILL', id]);
    }
    info = await this.inspect(name);
    if (info === 'absent') return await this.inspect(id) === 'absent';
    if (!this.owned(info, name, nonce, imageId, id)) return false;
    const removed = await this.process(['container', 'rm', '--force', id]);
    if (removed.fault || removed.code !== 0) return false;
    return await this.inspect(name) === 'absent' && await this.inspect(id) === 'absent';
  }

  async run(request: DocumentExportRequest): Promise<DocumentExportResult> {
    if (this.options.enabled !== true) return safeResult('DISABLED');
    const cli = this.options.dockerCliPath;
    const image = this.options.approvedImage;

    if (typeof cli !== 'string' || !cli || !isAbsolute(cli) || normalize(cli) !== cli || cli.includes('\0') || typeof image !== 'string' || image.length !== 71 || !IMAGE.test(image)) return safeResult('INVALID_CONFIGURATION');
    let parsed: ReturnType<typeof parseInput>;
    try { parsed = parseInput(request); } catch { return safeResult('INVALID_INPUT'); }
    if (request.signal?.aborted) return safeResult('ABORTED');
    if (DocumentExportExecutor.quarantined) return safeResult('CLEANUP_UNCONFIRMED', false);
    if (DocumentExportExecutor.active >= 1) return safeResult('BUSY'); // No queued admissions or leaked listeners.
    DocumentExportExecutor.active++;
    const deadline = performance.now() + (request.timeoutMs ?? 15_000);
    const interrupted = (): DocumentExportOutcome | undefined => request.signal?.aborted ? 'ABORTED' : performance.now() >= deadline ? 'TIMEOUT' : undefined;
    const nonce = randomBytes(24).toString('hex');
    const name = `aij-document-export-${randomBytes(16).toString('hex')}`;
    let id: string | undefined;
    let imageId = '';
    let createAttempted = false;
    let createUncertain = false;
    let creatorUnreaped = false;
    let executionUnreaped = false;
    let result = safeResult('EXECUTION_FAILED');
    try {
      await access(cli, constants.X_OK);
      const localImage = await this.process(['image', 'inspect', '--format', '{{json .Id}}', image], '', Math.min(CONTROL_MS, Math.max(1, deadline - performance.now())), request.signal);
      if (localImage.fault || localImage.code !== 0) return safeResult(interrupted() ?? 'IMAGE_UNAVAILABLE');
      try { imageId = JSON.parse(localImage.stdout.toString('utf8')) as string; } catch { return safeResult('IMAGE_UNAVAILABLE'); }
      if (imageId !== image) return safeResult('IMAGE_UNAVAILABLE');
      const early = interrupted();
      if (early) return safeResult(early);
      createAttempted = true;
      const created = await this.process(['container', 'create', '--pull', 'never', '--name', name,
        '--label', `${NONCE_LABEL}=${nonce}`, '--network', 'none', '--read-only', '--user', '65534:65534',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--cpus', '1',
        '--memory', '512m', '--memory-swap', '512m', '--ulimit', 'nofile=64:64', '--ulimit', 'core=0',
        '--log-driver', 'none', '--tmpfs', '/work:rw,noexec,nosuid,size=64m,mode=1777',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777', '--workdir', '/work',
        '--ipc', 'private', '--pid', '', '--cgroupns', 'private', '--no-healthcheck',
        '--interactive', '--attach', 'stdin', '--attach', 'stdout', '--attach', 'stderr', '--entrypoint', '/usr/local/bin/node', image, '/aij/document-renderer-cli.js'], '', Math.min(CONTROL_MS, Math.max(1, deadline - performance.now())), request.signal);
      creatorUnreaped = !created.closed;
      const candidateId = created.stdout.toString('utf8').trim();
      // Even a lost/broken create response may have created a container; recover only via random owned name.
      createUncertain = !!created.fault || created.code !== 0 || !ID.test(candidateId);
      if (ID.test(candidateId) && !createUncertain) id = candidateId;
      const info = await this.inspect(name);
      if (!this.owned(info, name, nonce, imageId, id)) {
        result = safeResult(interrupted() ?? 'EXECUTION_FAILED');
      } else if (createUncertain) {
        id = info.id;
        result = safeResult(interrupted() ?? 'EXECUTION_FAILED');
      } else if (interrupted()) {
        result = safeResult(interrupted()!);
      } else {
        // No await or caller callbacks between owned inspection and starting this exact ID.
        const execution = await this.process(['container', 'start', '--attach', '--interactive', info.id], parsed.protocol,
          Math.max(1, deadline - performance.now()), request.signal, OUTPUT_LIMIT);
        executionUnreaped = !execution.closed;
        const final = await this.inspect(name);
        let outcome: DocumentExportOutcome = execution.fault ?? interrupted() ?? 'EXECUTION_FAILED';
        if (!execution.fault && !interrupted() && this.owned(final, name, nonce, imageId, id) && final.state === 'exited' && execution.code === final.exitCode) {
          outcome = final.oomKilled ? 'OOM_KILLED' : final.exitCode === 0 && execution.code === 0 ? 'SUCCESS' : 'RENDERER_REJECTED';
        }
        if (execution.fault || outcome !== 'SUCCESS') result = safeResult(outcome);
        else {
          try {
            if (execution.stderr.length !== 0) throw Error('protocol');
            result = { outcome, artifact: parseOutput(execution.stdout, parsed.format), cleanupConfirmed: false };
          } catch { result = safeResult('INVALID_PROTOCOL'); }
        }
      }
    } catch { result = safeResult(interrupted() ?? 'EXECUTION_FAILED'); }
    finally {
      if (createAttempted) {
        let clean = false;
        try { clean = await this.cleanup(name, nonce, imageId, id, createUncertain); } catch { /* fail closed */ }
        clean = clean && !creatorUnreaped && !executionUnreaped;
        result.cleanupConfirmed = clean;
        if (!clean) {
          DocumentExportExecutor.quarantined = true; // No further admission while any owned resource has unknown liveness.
          result = safeResult('CLEANUP_UNCONFIRMED', false);
        }
      }
      DocumentExportExecutor.active--;
    }
    return result;
  }
}
