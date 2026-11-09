import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import environment from "../runtime-environment.cjs";

const { repositoryRoot, resolveDatabaseEnvironment: check, resolveRuntimeEnvironment: runtime } = environment;
const parent = join(repositoryRoot, ".artifacts/af-004/database-tests");
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "run-"));
// Confirm ignored destination before persisting even synthetic passwords.
execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", join(root, ".env")], { cwd: repositoryRoot });
const probe = join(root, "deny-network.cjs");
writeFileSync(probe, [
  "const fs = require('node:fs');",
  "const deny = () => { fs.appendFileSync(process.env.AIJ_DB_NETWORK_PROBE, 'attempt\\n'); throw new Error('Network forbidden in database configuration check'); };",
  "require('node:net').Socket.prototype.connect = deny;",
  "require('node:tls').connect = deny;",
  "require('node:dgram').createSocket = deny;",
  "const dns = require('node:dns');",
  "for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns[name] = deny;"
].join("\n"), { mode: 0o600 });
const cli = join(repositoryRoot, "scripts/db-check.mjs");
const url = (mode, password, host = "127.0.0.1") => {
  const name = "aij_foundation_" + mode;
  return "postgresql://" + name + ":" + encodeURIComponent(password) + "@" + host + ":" +
    (mode === "dev" ? 55432 : 55433) + "/" + name + "?schema=public";
};
const makeValues = () => {
  const passwords = [randomBytes(32).toString("hex") + "@:/?#%+", randomBytes(32).toString("hex") + "@:/?#%+"];
  return {
    passwords,
    values: {
      NODE_ENV: "development", RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation",
      DATABASE_URL: url("dev", passwords[0]), TEST_DATABASE_URL: url("test", passwords[1])
    }
  };
};
let sequence = 0;
function execute(args, overrides = {}, processOverrides = {}) {
  const fixture = makeValues();
  const values = { ...fixture.values, ...overrides };
  const prefix = join(root, String(++sequence).padStart(3, "0"));
  const file = prefix + ".env";
  writeFileSync(file, Object.entries(values).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n", { mode: 0o600 });
  assert.deepEqual(parseEnv(readFileSync(file, "utf8")), values, "real ignored environment file must round-trip");
  const marker = prefix + ".network-attempts";
  const command = [process.execPath, "--env-file=" + file, "--require=" + probe, cli, ...args, "--config-only"];
  const child = spawnSync(command[0], command.slice(1), {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH, AIJ_DB_NETWORK_PROBE: marker, ...processOverrides }
  });
  assert.equal(child.error, undefined, "actual CLI must execute");
  assert.equal(child.signal, null);
  assert.equal(existsSync(marker), false, "no DNS/TCP/TLS/UDP calls, including the old database port");
  const output = child.stdout + child.stderr;
  for (const password of fixture.passwords) {
    assert.ok(!output.includes(password) && !output.includes(encodeURIComponent(password)), "never log raw or encoded synthetic passwords");
  }
  for (const value of [values.DATABASE_URL, values.TEST_DATABASE_URL]) {
    if (value) assert.ok(!output.includes(value), "never log complete input URLs");
    const encoded = value?.match(/^[a-z]+:\/\/[^:@/]*:([^@]+)@/i)?.[1];
    if (encoded) {
      assert.ok(!output.includes(encoded), "never log credentials from overridden failure fixtures");
      let decoded;
      try { decoded = decodeURIComponent(encoded); } catch { /* Invalid encoding must also stay private. */ }
      if (decoded) assert.ok(!output.includes(decoded), "never log decoded credentials from failure fixtures");
    }
  }
  const report = JSON.parse(child.status === 0 ? child.stdout : child.stderr);
  assert.equal(report.connectionAttempted, false);
  // Store only verified sanitized output and command paths, never the fixture values.
  writeFileSync(prefix + ".json", JSON.stringify({ command, exitCode: child.status, stdout: child.stdout, stderr: child.stderr, networkAttempts: 0 }, null, 2));
  return { ...child, report, fixtureFile: file };
}

test("network-denial probe actually intercepts a synthetic connection before socket creation", () => {
  const marker = join(root, "probe-self-test.network-attempts");
  const child = spawnSync(process.execPath, ["--require=" + probe, "--eval", "require('node:net').connect({host:'127.0.0.1',port:9})"], {
    encoding: "utf8", timeout: 10000, env: { AIJ_DB_NETWORK_PROBE: marker }
  });
  assert.equal(child.status, 1);
  assert.equal(readFileSync(marker, "utf8"), "attempt\n");
  assert.match(child.stderr, /Network forbidden/);
});

for (const mode of ["dev", "test"]) {
  for (const host of ["127.0.0.1", "localhost"]) {
    test(mode + " exact loopback whitelist returns sanitized immutable configuration: " + host, () => {
      const { passwords, values } = makeValues();
      values[mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL"] = url(mode, passwords[0], host);
      const target = check(mode, values);
      assert.deepEqual(target, {
        mode, variable: mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL",
        host, port: mode === "dev" ? 55432 : 55433, database: "aij_foundation_" + mode, user: "aij_foundation_" + mode
      });
      assert.ok(Object.isFrozen(target));
      for (const password of passwords) assert.ok(!JSON.stringify(target).includes(password));
      assert.ok(!("password" in target) && !("url" in target));
    });
  }
  test("actual CLI reads an ignored synthetic env file and checks " + mode + " without connecting", () => {
    const result = execute(["--", mode]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.report.status, "CONFIG_VALID");
    assert.equal(result.report.target.database, "aij_foundation_" + mode);
    assert.equal(result.report.target.port, mode === "dev" ? 55432 : 55433);
  });
}

test("selection is independent: invalid unused URL and application flags cannot supply a fallback", () => {
  const { values } = makeValues();
  assert.equal(check("test", { ...values, DATABASE_URL: "invalid", DATABASE_ENABLED: "false", APP_ENV: "development" }).mode, "test");
  assert.equal(check("dev", { ...values, TEST_DATABASE_URL: "invalid", DATABASE_ENABLED: "false" }).mode, "dev");
  for (const TEST_DATABASE_URL of [undefined, "", " ", "invalid"]) {
    assert.throws(() => check("test", { ...values, TEST_DATABASE_URL }), environment.DatabaseTargetError);
  }
  assert.throws(() => check("dev", { TEST_DATABASE_URL: values.TEST_DATABASE_URL }), /DATABASE_URL is required/);
});

test("real CLI process environment overrides file values, including an explicit empty test URL", () => {
  const result = execute(["test"], {}, { TEST_DATABASE_URL: "" });
  assert.equal(result.status, 2);
  assert.match(result.report.reason, /TEST_DATABASE_URL is required/);
});
test("actual CLI ignores only the unselected URL, even when application database capability is disabled", () => {
  assert.equal(execute(["test"], { DATABASE_URL: "invalid", DATABASE_ENABLED: "false" }).status, 0);
  assert.equal(execute(["dev"], { TEST_DATABASE_URL: "invalid", DATABASE_ENABLED: "false" }).status, 0);
});
test("root pnpm db:check command really executes both explicit modes with local fixture credentials", () => {
  for (const mode of ["dev", "test"]) {
    const { fixtureFile } = execute([mode]);
    const values = parseEnv(readFileSync(fixtureFile, "utf8"));
    const command = ["pnpm", "run", "db:check", "--", mode, "--config-only"];
    const child = spawnSync(command[0], command.slice(1), {
      cwd: repositoryRoot, encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_UPDATE_NOTIFIER: "1", ...values }
    });
    assert.equal(child.status, 0);
    assert.equal(child.stderr, "");
    const report = JSON.parse(child.stdout.split("\n").find((line) => line.startsWith("{")));
    assert.equal(report.status, "CONFIG_VALID");
    assert.equal(report.connectionAttempted, false);
    assert.equal(report.target.database, "aij_foundation_" + mode);
    for (const value of [values.DATABASE_URL, values.TEST_DATABASE_URL]) {
      const encoded = new URL(value).password;
      assert.ok(!child.stdout.includes(value) && !child.stdout.includes(encoded) && !child.stdout.includes(decodeURIComponent(encoded)));
    }
    writeFileSync(fixtureFile + ".pnpm.json", JSON.stringify({ command, exitCode: child.status, stdout: child.stdout, stderr: child.stderr }, null, 2));
  }
});

const failures = [
  ["original port 15435", "test", (v) => v.TEST_DATABASE_URL.replace(":55433/", ":15435/"), /target/],
  ["dev URL used as test", "test", (v) => v.DATABASE_URL, /target/],
  ["test URL used as dev", "dev", (v) => v.TEST_DATABASE_URL, /target/],
  ["old database name", "test", (v) => v.TEST_DATABASE_URL.replace("/aij_foundation_test?", "/qingqi_ai?"), /target/],
  ["other user", "test", (v) => v.TEST_DATABASE_URL.replace("aij_foundation_test:", "postgres:"), /target/],
  ["database suffix is not an exact host whitelist entry", "test", (v) => v.TEST_DATABASE_URL.replace("/aij_foundation_test?", "/aij_foundation_test_copy?"), /target/],
  ["external host", "test", (v) => v.TEST_DATABASE_URL.replace("@127.0.0.1:", "@203.0.113.10:"), /target/],
  ["all interfaces", "test", (v) => v.TEST_DATABASE_URL.replace("@127.0.0.1:", "@0.0.0.0:"), /target/],
  ["deceptive localhost suffix", "test", (v) => v.TEST_DATABASE_URL.replace("@127.0.0.1:", "@localhost.example:"), /target/],
  ["missing port", "test", (v) => v.TEST_DATABASE_URL.replace(":55433/", "/"), /target/],
  ["invalid port", "test", (v) => v.TEST_DATABASE_URL.replace(":55433/", ":65536/"), /valid project database URL/],
  ["wrong local port", "test", (v) => v.TEST_DATABASE_URL.replace(":55433/", ":5432/"), /target/],
  ["non-PostgreSQL protocol", "test", (v) => v.TEST_DATABASE_URL.replace("postgresql:", "mysql:"), /target/],
  ["query host override", "test", (v) => v.TEST_DATABASE_URL + "&host=203.0.113.10", /target/],
  ["unapproved schema", "test", (v) => v.TEST_DATABASE_URL.replace("schema=public", "schema=other"), /target/],
  ["duplicate query", "test", (v) => v.TEST_DATABASE_URL + "&schema=public", /target/],
  ["fragment", "test", (v) => v.TEST_DATABASE_URL + "#", /fragments/],
  ["empty query", "test", (v) => v.TEST_DATABASE_URL.replace("?schema=public", "?"), /target/],
  ["leading whitespace", "test", (v) => " " + v.TEST_DATABASE_URL, /whitespace/],
  ["empty URL", "test", () => "", /TEST_DATABASE_URL is required/],
  ["malformed URL containing credentials", "test", (v) => v.TEST_DATABASE_URL.replace("@127.0.0.1", "@["), /valid project database URL/],
  ["template password", "test", () => url("test", "REPLACE_TEST_ONLY"), /password/],
  ["long template password", "test", () => url("test", "CHANGE_ME_BEFORE_USING_THIS_DATABASE_123456789"), /password/],
  ["empty password", "test", () => url("test", ""), /password/],
  ["low-diversity password", "test", () => url("test", "a".repeat(64)), /password/],
  ["bad credentials encoding", "test", (v) => v.TEST_DATABASE_URL.replace(/:[^:]+@/, ":%ZZ@"), /encoding/],
  ["decoded password whitespace", "test", () => url("test", randomBytes(32).toString("hex") + "\n"), /password/],
  ["decoded password control character", "test", () => url("test", randomBytes(32).toString("hex") + "\0"), /password/]
];
for (const [name, mode, invalid, reason] of failures) {
  test("actual CLI rejects " + name + " before any network attempt and without input leakage", () => {
    const { values } = makeValues();
    const result = execute([mode], { [mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL"]: invalid(values) });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.report.status, "REJECTED");
    assert.match(result.report.reason, reason);
  });
}

test("missing/ambiguous mode and repeated separators are rejected by the actual CLI", () => {
  for (const args of [[], ["production"], ["dev", "test"], ["--", "--", "test"], ["test", "--unknown"]]) {
    assert.equal(execute(args).status, 2);
  }
});
test("test processes cannot explicitly select dev; generated projects cannot use the host check", () => {
  assert.equal(execute(["dev"], { NODE_ENV: "test" }).status, 2);
  assert.equal(execute(["test"], { PROJECT_ID: "alpha", RUNTIME_PROFILE: "project" }).status, 2);
  assert.equal(execute(["test"], { NODE_ENV: "test" }).status, 0);
});
test("runtime and database CLI share the exact whitelist while disabled database stays optional", () => {
  const { values } = makeValues();
  for (const [mode, APP_ENV] of [["dev", "development"], ["test", "test"]]) {
    const target = runtime({ ...values, APP_ENV, DATABASE_ENABLED: "true" }).databaseTarget;
    const checked = check(mode, values);
    for (const key of ["host", "port", "database", "user"]) assert.equal(target[key], checked[key]);
    const bad = { ...values, APP_ENV, DATABASE_ENABLED: "true", [checked.variable]: values[checked.variable].replace("/aij_foundation_" + mode + "?", "/aij_foundation_" + mode + "_copy?") };
    assert.throws(() => runtime(bad), environment.DatabaseTargetError);
  }
  assert.equal(runtime({ DATABASE_URL: "invalid", TEST_DATABASE_URL: "invalid" }).databaseTarget, null);
});
test("actual checks preserve source bytes and do not create declared application storage", () => {
  const files = ["scripts/runtime-environment.cjs", "scripts/db-check.mjs", "package.json"];
  const hashes = () => files.map((file) => createHash("sha256").update(readFileSync(join(repositoryRoot, file))).digest("hex"));
  const before = hashes();
  const storage = join(root, "must-not-create");
  assert.equal(execute(["dev"], { LOCAL_STORAGE_ROOT: storage }).status, 0);
  assert.equal(execute(["test"], { LOCAL_STORAGE_ROOT: storage }).status, 0);
  assert.deepEqual(hashes(), before);
  assert.equal(existsSync(storage), false);
});
