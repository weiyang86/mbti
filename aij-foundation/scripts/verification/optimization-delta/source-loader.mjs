import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

export const root = fileURLToPath(new URL('../../../', import.meta.url));

// Execute only the selected real source. Every runtime import must be explicitly
// supplied; no application bootstrap, Prisma client, network, timers or env files.
export function loadSource(path, imports = {}, globals = {}) {
  const source = readFileSync(resolve(root, path), 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: false
    }
  });
  assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, Buffer, Date,
    require: name => {
      assert.ok(Object.hasOwn(imports, name), `Unapproved offline dependency: ${name}`);
      return imports[name];
    },
    ...globals
  });
  new vm.Script(compiled.outputText, { filename: path }).runInContext(context, { timeout: 1000 });
  return module.exports;
}

export class HttpException extends Error {}
export class NotFoundException extends HttpException {}
export const nest = {
  Injectable: () => target => target,
  Inject: () => () => {}, Optional: () => () => {}, Catch: () => target => target,
  HttpException, NotFoundException,
  BadRequestException: class extends HttpException {},
  ConflictException: class extends HttpException {},
  ForbiddenException: class extends HttpException {},
  GoneException: class extends HttpException {},
  UnauthorizedException: class extends HttpException {},
  PayloadTooLargeException: class extends HttpException {},
  ServiceUnavailableException: class extends HttpException {}
};

export function controlledClock() {
  let now = Date.UTC(2026, 10, 4);
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  return { Date: ClockDate, advance: ms => { now += ms; } };
}
