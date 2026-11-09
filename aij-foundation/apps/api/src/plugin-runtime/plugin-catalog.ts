import { BadRequestException, NotFoundException } from "@nestjs/common";
import { resolveAllowlistedPluginModules, resolvePluginDependencyOrder, validatePluginCatalog } from "./plugin-manifest";
import type { PluginManifestV2, PluginRegistration } from "./plugin-manifest";

export type TrustedPluginRegistration = PluginRegistration & Readonly<{ owner: string }>;
export type PluginDescriptor = Readonly<{ code: string; name: string; version: string; owner: string }>;

/** Immutable view of modules explicitly imported by the host. The production host currently supplies an empty map. */
export class PluginCatalog {
  private readonly entries: ReadonlyMap<string, TrustedPluginRegistration>;

  constructor(registrations: ReadonlyMap<string, TrustedPluginRegistration> = new Map()) {
    const manifests: unknown[] = [];
    const normalized = new Map<string, TrustedPluginRegistration>();
    for (const [code, registration] of registrations) {
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code) || registration?.manifest?.code !== code ||
          typeof registration.module !== "function" || !registration.module.prototype ||
          typeof registration.owner !== "string" || !/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(registration.owner)) {
        throw new BadRequestException("Plugin registration is not trusted");
      }
      manifests.push(registration.manifest);
      normalized.set(code, Object.freeze({ ...registration }));
    }
    validatePluginCatalog(manifests);
    resolveAllowlistedPluginModules([...normalized.keys()], normalized);
    this.entries = normalized;
  }

  list(): PluginDescriptor[] {
    return [...this.entries.values()].map(({ manifest, owner }) => ({ code: manifest.code, name: manifest.name, version: manifest.version, owner }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  get(code: string): TrustedPluginRegistration {
    const registration = this.entries.get(code);
    if (!registration) throw new NotFoundException("Plugin is not in the trusted host catalog");
    return registration;
  }

  has(code: string): boolean { return this.entries.has(code); }

  manifest(code: string): PluginManifestV2 { return this.get(code).manifest; }

  dependencyOrder(): string[] {
    return resolvePluginDependencyOrder(new Map([...this.entries].map(([code, registration]) => [code, registration.manifest])));
  }

  dependentsOf(code: string): PluginManifestV2[] {
    return [...this.entries.values()].map(({ manifest }) => manifest)
      .filter(manifest => Object.hasOwn(manifest.dependencies, code))
      .sort((left, right) => left.code.localeCompare(right.code));
  }
}
