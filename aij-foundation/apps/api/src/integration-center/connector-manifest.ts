import { BadRequestException, NotFoundException } from "@nestjs/common";

export type ConnectorManifest = Readonly<{
  code: string;
  version: string;
  displayName: string;
  protocol: "webhook";
  scopes: readonly string[];
  secretProviders: readonly ("env" | "local")[];
}>;

// Trusted, code-owned allowlist. Connector entries describe contracts only; they do not load modules or contact endpoints.
const manifests: readonly ConnectorManifest[] = Object.freeze([
  Object.freeze({
    code: "aij-generic-webhook",
    version: "1.0.0",
    displayName: "Generic inbound webhook",
    protocol: "webhook",
    scopes: Object.freeze(["webhook:receive", "webhook:read"]),
    secretProviders: Object.freeze(["env", "local"] as const)
  })
]);
const byCode = new Map(manifests.map(manifest => [manifest.code, manifest]));

export function connectorCatalog(): readonly ConnectorManifest[] { return manifests; }

export function requireConnectorManifest(code: string): ConnectorManifest {
  const manifest = byCode.get(code);
  if (!manifest) throw new NotFoundException("Connector is not registered");
  return manifest;
}

export function validateGrantedScopes(manifest: ConnectorManifest, scopes: readonly string[]): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > manifest.scopes.length ||
      scopes.some(scope => typeof scope !== "string" || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(scope)) ||
      new Set(scopes).size !== scopes.length || scopes.some(scope => !manifest.scopes.includes(scope))) {
    throw new BadRequestException("Connector scopes exceed the registered manifest");
  }
  return [...scopes].sort();
}
