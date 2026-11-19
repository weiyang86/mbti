import assert from "node:assert/strict";
import { secretStoreEnvironment } from "./secret-store-fixture.mjs";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceRecord, assertLocalPath, repositoryRoot } from "../database/connection.mjs";

export function authKeys(id, task = "AF-013") {
  assert.ok(["AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-053", "AF-054", "AF-055", "AF-056", "AF-057", "AF-058", "AF-063", "AF-068", "AF-069", "AF-070", "AF-071", "AF-072", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085", "AF-086", "AF-087", "AF-088", "AF-089", "AF-090", "AF-092", "AF-093", "AF-094", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-100", "AF-101", "AF-102", "AF-104", "AF-105", "AF-106", "AF-107", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217", "AF-157", "AF-155"].includes(task));
  const lease = acceptanceRecord("test", id); assert.equal(lease.task, task);
  const directory = join(repositoryRoot, ".local-data/auth/test", lease.database), path = join(directory, "keys.json");
  assertLocalPath(path); execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", path], { cwd: repositoryRoot });
  if (!existsSync(path)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ task, repository: repositoryRoot, instanceId: lease.instanceId, database: lease.database, JWT_SECRET: randomBytes(32).toString("hex") }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  const value = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(value.task, task); assert.equal(value.repository, repositoryRoot); assert.equal(value.instanceId, lease.instanceId); assert.equal(value.database, lease.database);
  const deriveTestSecret = purpose => createHmac("sha256", value.JWT_SECRET).update("aij-foundation:test-fixture:" + purpose).digest("hex");
  return {
    path,
    secret: value.JWT_SECRET,
    clientJwtSecret: deriveTestSecret("client-jwt"),
    clientRateLimitSecret: deriveTestSecret("client-rate-limit"),
    clientTokenSecret: deriveTestSecret("client-token")
  };
}
export function authEnvironment(id, secret, task = "AF-013") {
  assert.ok(["AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-053", "AF-054", "AF-055", "AF-056", "AF-057", "AF-058", "AF-063", "AF-068", "AF-069", "AF-070", "AF-071", "AF-072", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085", "AF-086", "AF-087", "AF-088", "AF-089", "AF-090", "AF-092", "AF-093", "AF-094", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-100", "AF-101", "AF-102", "AF-104", "AF-105", "AF-106", "AF-107", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217", "AF-157", "AF-155"].includes(task));
  assert.ok(["AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-053", "AF-054", "AF-055", "AF-056", "AF-057", "AF-058", "AF-063", "AF-068", "AF-069", "AF-070", "AF-071", "AF-072", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085", "AF-086", "AF-087", "AF-088", "AF-089", "AF-090", "AF-092", "AF-093", "AF-094", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-100", "AF-101", "AF-102", "AF-104", "AF-105", "AF-106", "AF-107", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217", "AF-157", "AF-155"].includes(task));
  assert.equal(acceptanceRecord("test", id).task, task);
  const keys = authKeys(id, task);
  return { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    ...(task === "AF-023" ? secretStoreEnvironment(id) : {}), RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation", APP_ENV: "test", NODE_ENV: "test", DATABASE_ACCEPTANCE_ID: id,
    AUTH_ENABLED: "true", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "true", STORAGE_ENABLED: "false", ASYNC_RUNTIME_ENABLED: ["AF-049", "AF-050", "AF-051", "AF-052"].includes(task) ? "true" : "false", ENABLED_PLUGINS: "", JWT_SECRET: secret,
    CLIENT_JWT_SECRET: keys.clientJwtSecret,
    CLIENT_AUTH_RATE_LIMIT_SECRET: keys.clientRateLimitSecret,
    CLIENT_AUTH_TOKEN_SECRET: keys.clientTokenSecret,
    WEB_PORT: "3655", API_PORT: "3656", WEB_URL: "http://localhost:3655", NEXT_PUBLIC_API_URL: "http://localhost:3656/api",
    JWT_ISSUER: "urn:aij:aij-foundation:test:api", COOKIE_PREFIX: "aij_foundation_test", LOCAL_STORAGE_ROOT: ".local-data/aij-foundation/test/storage" };
}
