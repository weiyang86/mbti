import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';

const IMAGE = /^docker\.io\/library\/python@sha256:[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{64}$/;
const NONCE_LABEL = 'io.aij.python-sandbox.nonce';
const OUTPUT_LIMIT = 64 * 1024;
const CONTROL_LIMIT = 16 * 1024;
const CONTROL_MS = 5_000;
const INSPECT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"nonce":{{json (index .Config.Labels "io.aij.python-sandbox.nonce")}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}}}';
// This constant alone enters argv. User source is compiled ONLY by this container wrapper.
const WRAPPER = `import sys,json,io
sys.stdout.reconfigure(encoding="utf-8",errors="strict")
sys.stderr.reconfigure(encoding="utf-8",errors="strict")
p=json.loads(sys.stdin.buffer.readline(1024*1024).decode("utf-8"))
sys.stdin=io.StringIO("")
g={"__name__":"__main__","input_data":p["input"]}
exec(compile(p["script"],"<sandbox>","exec"),g,g)
`;

export type PythonSandboxOutcome = 'SUCCESS' | 'DISABLED' | 'INVALID_CONFIGURATION' | 'INVALID_INPUT'
  | 'BUSY' | 'ABORTED' | 'TIMEOUT' | 'OUTPUT_LIMIT' | 'INVALID_UTF8' | 'IMAGE_UNAVAILABLE'
  | 'EXECUTION_FAILED' | 'SCRIPT_NONZERO' | 'OOM_KILLED' | 'CLEANUP_UNCONFIRMED';
export interface PythonSandboxResult {
  outcome: PythonSandboxOutcome;
  /** Untrusted, private RAM only. Never render as HTML, log, or persist implicitly. */
  stdout: string;
  /** Untrusted script output, never Docker control/daemon errors. */
  stderr: string;
  exitCode?: number;
  cleanupConfirmed: boolean;
}
/** Administrator-only construction; never accept these options from a client. */
export interface PythonSandboxOptions {
  enabled?: boolean;
  dockerCliPath?: string;
  approvedImage?: string;
  maxConcurrency?: 1 | 2;
}
export interface PythonSandboxRequest {
  script: string;
  /** Strict JSON text, at most 256 KiB, depth 32, 10,000 object keys/array entries. */
  inputJson: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
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
const safeResult = (outcome: PythonSandboxOutcome, cleanupConfirmed = true): PythonSandboxResult =>
  ({ outcome, stdout: '', stderr: '', cleanupConfirmed });
function utf8(text: string): boolean {
  return Buffer.from(text, 'utf8').toString('utf8') === text;
}
function parseInput(request: PythonSandboxRequest): string {
  if (typeof request.script !== 'string' || typeof request.inputJson !== 'string'
    || Buffer.byteLength(request.script) > 64 * 1024 || Buffer.byteLength(request.inputJson) > 256 * 1024
    || !utf8(request.script) || !utf8(request.inputJson)
    || (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 30_000))) throw new Error('input');
  const value: unknown = JSON.parse(request.inputJson);
  // JSON.parse accepts duplicate keys; reject them before creating the protocol.
  const stack: { keys: Set<string> | null; expectKey: boolean }[] = [];
  for (const token of request.inputJson.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]/g) ?? []) {
    const top = stack[stack.length - 1];
    if (token === '{' || token === '[') stack.push({ keys: token === '{' ? new Set() : null, expectKey: true });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':') { if (top) top.expectKey = false; }
    else if (token === ',') { if (top) top.expectKey = true; }
    else if (top?.keys && top.expectKey) {
      const key = JSON.parse(token) as string;
      if (top.keys.has(key)) throw new Error('duplicate');
      top.keys.add(key);
    }
  }
  let entries = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 32) throw new Error('depth');
    if (typeof node === 'number' && !Number.isFinite(node)) throw new Error('number');
    if (typeof node === 'string' && !utf8(node)) throw new Error('unicode');
    if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      entries += keys.length;
      if (entries > 10_000) throw new Error('keys');
      for (const key of keys) {
        if (!utf8(key)) throw new Error('unicode');
        visit((node as Record<string, unknown>)[key], depth + 1);
      }
    }
  };
  visit(value, 0);
  return JSON.stringify({ script: request.script, input: value }) + '\n';
}

/** Local Docker engine adapter. No host interpreter, mounts, shell, pull, or caller CLI options. */
export class PythonSandboxRunner {
  private active = 0;
  private readonly options: Readonly<PythonSandboxOptions>;
  constructor(options: PythonSandboxOptions = {}) { this.options = Object.freeze({ ...options }); }

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
        env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent/aij-python-docker-config', LANG: 'C.UTF-8' },
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
          const remaining = limit - sizes[index];
          if (remaining > 0) chunks[index].push(data.subarray(0, remaining));
          sizes[index] += data.length;
          if (sizes[index] > limit) stop('OUTPUT_LIMIT');
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
    return typeof info === 'object' && info !== null && ID.test(info.id) && (!expectedId || info.id === expectedId)
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

  async run(request: PythonSandboxRequest): Promise<PythonSandboxResult> {
    if (this.options.enabled !== true) return safeResult('DISABLED');
    const cli = this.options.dockerCliPath;
    const image = this.options.approvedImage;
    const concurrency = this.options.maxConcurrency ?? 1;
    if (typeof cli !== 'string' || !cli || !isAbsolute(cli) || normalize(cli) !== cli || cli.includes('\0') || typeof image !== 'string' || !IMAGE.test(image)
      || ![1, 2].includes(concurrency)) return safeResult('INVALID_CONFIGURATION');
    let protocol: string;
    try { protocol = parseInput(request); } catch { return safeResult('INVALID_INPUT'); }
    if (request.signal?.aborted) return safeResult('ABORTED');
    if (this.active >= concurrency) return safeResult('BUSY'); // No queued admissions or leaked listeners.
    this.active++;
    const deadline = performance.now() + (request.timeoutMs ?? 10_000);
    const interrupted = (): PythonSandboxOutcome | undefined => request.signal?.aborted ? 'ABORTED' : performance.now() >= deadline ? 'TIMEOUT' : undefined;
    const nonce = randomBytes(24).toString('hex');
    const name = `aij-python-${randomBytes(16).toString('hex')}`;
    let id: string | undefined;
    let imageId = '';
    let createAttempted = false;
    let createUncertain = false;
    let creatorUnreaped = false;
    let result = safeResult('EXECUTION_FAILED');
    try {
      await access(cli, constants.X_OK);
      const localImage = await this.process(['image', 'inspect', '--format', '{{json .Id}}', image]);
      if (localImage.fault || localImage.code !== 0) return safeResult(interrupted() ?? 'IMAGE_UNAVAILABLE');
      try { imageId = JSON.parse(localImage.stdout.toString('utf8')) as string; } catch { return safeResult('IMAGE_UNAVAILABLE'); }
      if (typeof imageId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(imageId)) return safeResult('IMAGE_UNAVAILABLE');
      const early = interrupted();
      if (early) return safeResult(early);
      createAttempted = true;
      const created = await this.process(['container', 'create', '--pull', 'never', '--name', name,
        '--label', `${NONCE_LABEL}=${nonce}`, '--network', 'none', '--read-only', '--user', '65532:65532',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--cpus', '1',
        '--memory', '256m', '--memory-swap', '256m', '--ulimit', 'nofile=64:64', '--ulimit', 'core=0',
        '--log-driver', 'none', '--tmpfs', '/work:rw,noexec,nosuid,size=64m,mode=1777',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777', '--workdir', '/work',
        '--ipc', 'private', '--pid', '', '--cgroupns', 'private', '--no-healthcheck',
        '--interactive', '--attach', 'stdin', '--attach', 'stdout', '--attach', 'stderr', '--entrypoint', '/usr/local/bin/python3', image, '-I', '-S', '-B', '-u', '-c', WRAPPER]);
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
        const execution = await this.process(['container', 'start', '--attach', '--interactive', info.id], protocol,
          Math.max(1, deadline - performance.now()), request.signal, OUTPUT_LIMIT);
        const final = await this.inspect(name);
        let outcome: PythonSandboxOutcome = execution.fault ?? interrupted() ?? 'EXECUTION_FAILED';
        if (!execution.fault && !interrupted() && this.owned(final, name, nonce, imageId, id) && final.state === 'exited' && execution.code === final.exitCode) {
          outcome = final.oomKilled ? 'OOM_KILLED' : final.exitCode === 0 && execution.code === 0 ? 'SUCCESS' : 'SCRIPT_NONZERO';
          result.exitCode = final.exitCode;
        }
        // On CLI failure, do not expose possible Docker diagnostics mixed into stderr.
        if (execution.fault || outcome === 'EXECUTION_FAILED') result = safeResult(outcome);
        else {
          try {
            result = { outcome, stdout: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(execution.stdout),
              stderr: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(execution.stderr),
              cleanupConfirmed: false, ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }) };
          } catch { result = safeResult('INVALID_UTF8'); }
        }
      }
    } catch { result = safeResult(interrupted() ?? 'EXECUTION_FAILED'); }
    finally {
      if (createAttempted) {
        let clean = false;
        try { clean = await this.cleanup(name, nonce, imageId, id, createUncertain); } catch { /* fail closed */ }
        clean = clean && !creatorUnreaped;
        result.cleanupConfirmed = clean;
        if (!clean) result = safeResult('CLEANUP_UNCONFIRMED', false);
      }
      this.active--;
    }
    return result;
  }
}
