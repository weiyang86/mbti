import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type MenuPage = Readonly<{ path: string; pluginCode: string | null }>;
// Actual app route only. New core/plugin pages must be registered by their delivery owner.
export const MENU_PAGES: readonly MenuPage[] = Object.freeze([
  ...["/", "/admin", "/auth/admin-users", "/auth/roles", "/auth/dictionaries", "/auth/configuration", "/auth/secrets", "/auth/audit-logs", "/auth/files", "/auth/clients", "/auth/integrations"].map(path => Object.freeze({ path, pluginCode: null })),
  Object.freeze({ path: "/auth/ai/center", pluginCode: "aij-ai" }),
  Object.freeze({ path: "/auth/ai/usage", pluginCode: "aij-ai" }),
  Object.freeze({ path: "/auth/ai/traces", pluginCode: "aij-ai" }),
  Object.freeze({ path: "/auth/payments", pluginCode: "aij-payment" })
]);
@Injectable()
export class MenuAvailabilityService {
  constructor(private readonly config: ConfigService) {}
  pluginEnabled(code: string | null): boolean { return code === null || (this.config.get<string[]>("enabledPlugins") ?? []).includes(code); }
  pageAvailable(path: string, pluginCode: string | null): boolean {
    return this.pluginEnabled(pluginCode) && MENU_PAGES.some(page => page.path === path && page.pluginCode === pluginCode);
  }
  catalog() { return MENU_PAGES.map(page => ({ ...page, available: this.pageAvailable(page.path, page.pluginCode) })); }
}
