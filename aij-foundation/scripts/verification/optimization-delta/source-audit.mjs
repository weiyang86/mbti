import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { root } from './source-loader.mjs';

const read = path => readFileSync(resolve(root, path), 'utf8');
const decorators = node => ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
const call = decorator => ts.isCallExpression(decorator.expression) ? decorator.expression : null;

export function sourceAudit() {
  const controllerPath = 'apps/api/src/plugins/aij-ai/ai-knowledge.controller.ts';
  const parsed = ts.createSourceFile(controllerPath, read(controllerPath), ts.ScriptTarget.Latest, true);
  const controller = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AiKnowledgeController');
  const routes = controller.members.flatMap(method => {
    const calls = decorators(method).map(call).filter(Boolean);
    const route = calls.find(c => ['Get', 'Post', 'Patch', 'Delete', 'Put'].includes(c.expression.getText(parsed)));
    if (!route) return [];
    const service = method.body.getText(parsed).match(/this\.(knowledge|evaluations)\.([A-Za-z]+)\(/);
    return [{
      method: route.expression.getText(parsed).toUpperCase(),
      path: '/api/client/ai/knowledge/' + route.arguments[0].text,
      handler: method.name.getText(parsed),
      service: service ? `${service[1]}.${service[2]}` : null,
      workspaceGuard: calls.some(c => c.expression.getText(parsed) === 'UseGuards' && c.arguments.some(a => a.getText(parsed) === 'WorkspaceContextGuard')),
      permission: calls.find(c => c.expression.getText(parsed) === 'RequireClientWorkspacePermissions')?.arguments[0]?.getText(parsed) ?? null
    }];
  });
  const trustedPath = 'apps/api/src/plugin-runtime/trusted-plugins.ts';
  const registrations = [...read(trustedPath).matchAll(/from "(\.\.\/plugins\/[^"]+)"/g)].map(m => {
    const path = resolve(root, 'apps/api/src/plugin-runtime', m[1] + '.ts');
    return readFileSync(path, 'utf8').match(/code:\s*["'](aij-[a-z]+)["']/)?.[1];
  });
  const startupPath = 'scripts/plugin-launch-policy.mjs';
  const startup = [...read(startupPath).matchAll(/"(aij-[a-z]+)"/g)].map(m => m[1]);
  const jobSource = read('apps/api/src/async-runtime/job.service.ts');
  const lease = jobSource.slice(jobSource.indexOf('private async admitLease('), jobSource.indexOf('\n  list(status?'));
  const paths = [controllerPath, trustedPath, startupPath,
    'apps/api/src/plugin-runtime/plugin-management.module.ts',
    'apps/api/src/plugin-runtime/plugin-runtime.module.ts',
    'apps/api/src/plugin-runtime/plugin-runtime-access.service.ts',
    'apps/api/src/async-runtime/job.service.ts',
    'apps/api/src/async-runtime/runtime-health.service.ts',
    'apps/api/src/async-runtime/runtime-worker.service.ts',
    'apps/api/src/plugins/aij-ai/ai-knowledge.service.ts',
    'apps/api/src/plugins/aij-ai/ai-evaluation.service.ts'];
  return {
    scope: 'SOURCE_AUDIT_ONLY', productAcceptance: 'PARTIAL_NOT_CLOSED',
    catalog: { trusted: registrations.sort(), startup: startup.sort(),
      runtimeAndManagementShareTrustedCatalog: ['plugin-runtime', 'plugin-management'].every(name => read(`apps/api/src/plugin-runtime/${name}.module.ts`).includes('TRUSTED_PLUGINS')),
      startupUsesTrustedSource: read(startupPath).includes('TRUSTED_PLUGINS') },
    leaseSourceChecks: {
      currentIdentity: ['id = ${row.id}', "status = 'running'", 'lease_owner = ${row.lease_owner}', 'attempts = ${row.attempts}', 'lease_expires_at > NOW()', 'deleted_at IS NULL', 'FOR UPDATE'].every(token => lease.includes(token)),
      duplicateAdmissionTuple: jobSource.includes('isDeepStrictEqual(existing.resultReference, admission)'),
      admissionOwnerAndAttempt: jobSource.includes('const admission = { jobId: row.id, leaseOwner: row.lease_owner, attempt: row.attempts, leaseNonce: row.lease_nonce }'),
      caveat: 'Source predicates only; no independent DB connection or process was exercised'
    },
    knowledgeRoutes: routes,
    sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(read(path)).digest('hex')]))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(JSON.stringify(sourceAudit(), null, 2) + '\n');
}
