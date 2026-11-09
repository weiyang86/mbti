// Adapted from source cd8d006: singleton client and OnModuleDestroy; provenance section 11.
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readApplicationEnvironment, readDatabaseEnvironment, RuntimeEnvironment } from "../../../../scripts/runtime-environment.cjs";

type Probe = { ready: boolean; reason: string };
type Identity = { database: string; user: string; sessionUser: string; serverPort: number };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly applicationName = "aij-api:" + process.pid + ":" + randomUUID().slice(0, 8);
  private readonly configured: boolean;
  private readonly target: RuntimeEnvironment["databaseTarget"];
  private closing = false;
  private pending?: Promise<Probe>;

  constructor(config: ConfigService) {
    const configured = config.getOrThrow<RuntimeEnvironment["capabilities"]>("capabilities").database;
    const target = config.getOrThrow<RuntimeEnvironment["databaseTarget"]>("databaseTarget");
    let url = "postgresql://aij_disabled@127.0.0.1:1/aij_disabled";
    if (configured) {
      const values = readApplicationEnvironment();
      const mode = config.getOrThrow<string>("environment") === "test" ? "test" : "dev";
      const selected = config.getOrThrow<string>("profile") === "host" ? readDatabaseEnvironment(mode, values, values.DATABASE_ACCEPTANCE_ID) : values;
      url = selected[mode === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL"]!;
    }
    const connection = new URL(url);
    connection.searchParams.set("connection_limit", "1");
    connection.searchParams.set("connect_timeout", "2");
    connection.searchParams.set("pool_timeout", "2");
    super({ datasources: { db: { url: connection.href } }, errorFormat: "minimal", log: [] });
    this.configured = configured;
    this.target = target;
  }

  // Lazy queries keep process liveness available during a database outage.
  readiness(): Promise<Probe> {
    if (this.closing) return Promise.resolve({ ready: false, reason: "SHUTTING_DOWN" });
    if (!this.configured) return Promise.resolve({ ready: false, reason: "DATABASE_NOT_CONFIGURED" });
    if (!this.pending) this.pending = this.probe().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async probe(): Promise<Probe> {
    let expected: Array<{ name: string; checksum: string }>;
    try {
      const directory = resolve(__dirname, "../../prisma/migrations");
      expected = readdirSync(directory, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("._")).map((e) => {
        if (!/^\d{14}_[a-z0-9_]+$/.test(e.name)) throw new Error("Invalid migration metadata");
        return { name: e.name, checksum: createHash("sha256").update(readFileSync(resolve(directory, e.name, "migration.sql"))).digest("hex") };
      });
      if (!expected.length) throw new Error("No migrations");
    } catch { return { ready: false, reason: "MIGRATION_METADATA_UNAVAILABLE" }; }
    try {
      return await this.$transaction(async (client) => {
        await client.$queryRaw`SELECT set_config('application_name', ${this.applicationName}, false)`;
        const [identity] = await client.$queryRaw<Identity[]>`SELECT current_database() AS database,current_user AS "user",session_user AS "sessionUser",inet_server_port() AS "serverPort"`;
        if (!identity || identity.database !== this.target?.database || identity.user !== this.target.user || identity.sessionUser !== this.target.user || identity.serverPort !== 5432) return { ready: false, reason: "DATABASE_IDENTITY_MISMATCH" };
        const [ledger] = await client.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
        if (!ledger.present) return { ready: false, reason: "MIGRATIONS_MISSING" };
        const rows = await client.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations`;
        if (rows.length !== expected.length || rows.some((row) => !row.finished_at || row.rolled_back_at || !expected.some((m) => m.name === row.migration_name && m.checksum === row.checksum))) return { ready: false, reason: "MIGRATIONS_INCOMPLETE" };
        return { ready: true, reason: "READY" };
      }, { maxWait: 2000, timeout: 2000 });
    } catch { return { ready: false, reason: "DATABASE_UNAVAILABLE" }; }
  }

  async onModuleDestroy() {
    this.closing = true;
    await this.pending;
    try { await this.$disconnect(); }
    catch { throw new Error("PRISMA_DISCONNECT_FAILED"); }
  }
}
