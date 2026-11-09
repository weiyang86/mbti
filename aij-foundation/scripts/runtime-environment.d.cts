export type ProjectInput = Readonly<{
  projectId: string;
  environment: "development" | "test" | "production";
  webPort: number | string;
  apiPort: number | string;
  origin: string;
  apiUrl: string;
  issuer: string;
  cookiePrefix: string;
  storageRoot: string;
  enabledPlugins?: readonly string[];
  capabilities?: Readonly<{ auth?: boolean; clientAuth?: boolean; database?: boolean; storage?: boolean }>;
  secrets?: NodeJS.ProcessEnv;
  databaseUrl?: string;
}>;
export type ProjectOptions = Readonly<{
  projectRoot?: string;
  peers?: readonly ProjectConfiguration[];
  pluginSecretRequirements?: Readonly<Record<string, readonly string[]>>;
}>;
export type ProjectConfiguration = Readonly<{
  contract: "aij.project-config/v1";
  profile: "host" | "project";
  repositoryRoot: string;
  projectId: string;
  environment: "development" | "test" | "production";
  namespace: string;
  serviceId: string;
  webPort: number;
  apiPort: number;
  webUrl: string;
  origin: string;
  apiUrl: string;
  listenHost: "127.0.0.1";
  issuer: string;
  cookiePrefix: string;
  clientSessionCookie: string;
  workspaceSessionCookie: string;
  adminTokenStorageKey: string;
  storageRoot: string;
  enabledPlugins: readonly string[];
  capabilities: Readonly<{ auth: boolean; clientAuth: boolean; database: boolean; storage: boolean }>;
  databaseTarget: Readonly<{ host: string; port: number; database: string; user: string; acceptanceId?: string }> | null;
}>;
export type RuntimeEnvironment = ProjectConfiguration & Readonly<{
  nodeEnv: "development" | "test" | "production";
  trustProxyHops: number;
  asyncRuntimeEnabled: boolean;
  documentExport?: Readonly<{ enabled: boolean; approvedImage: string; dockerCliPath: string }>;
}>;
export const repositoryRoot: string;
export function resolveProjectConfiguration(input: ProjectInput, options?: ProjectOptions): ProjectConfiguration;
export function assertProjectIsolation(configs: readonly ProjectConfiguration[]): true;
export function assertRuntimeCapabilities(config: ProjectConfiguration & Partial<Pick<RuntimeEnvironment, "asyncRuntimeEnabled">>): void;
export function resolveRuntimeEnvironment(environment?: NodeJS.ProcessEnv): RuntimeEnvironment;
export function readRepositoryEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function readApplicationEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function readDatabaseEnvironment(mode: "dev" | "test", environment?: NodeJS.ProcessEnv, acceptanceId?: string): NodeJS.ProcessEnv;
export function loadRuntimeEnvironment(environment?: NodeJS.ProcessEnv): RuntimeEnvironment;
export class DatabaseTargetError extends Error {}
export function resolveDatabaseEnvironment(mode: "dev" | "test", environment?: NodeJS.ProcessEnv): Readonly<{
  mode: "dev" | "test";
  variable: "DATABASE_URL" | "TEST_DATABASE_URL";
  host: string;
  port: number;
  database: string;
  user: string;
}>;
