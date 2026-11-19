import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import environment from "./runtime-environment.cjs";

const root = environment.repositoryRoot;
const output = resolve(root, ".artifacts/f01-closeout/dev-reload.json");
const apiFile = resolve(root, "apps/api/src/health.controller.ts");
const webFile = resolve(root, "apps/web/app/page.tsx");
const original = { api: await readFile(apiFile, "utf8"), web: await readFile(webFile, "utf8") };
const last = { ...original };
const evidence = { startedAt: new Date().toISOString(), rounds: [], restored: false };
const hash = (text) => createHash("sha256").update(text).digest("hex");

function command(pid) {
  const row = execFileSync("ps", ["-p", String(pid), "-o", "ppid=,args="], { encoding: "utf8" }).trim();
  const match = row.match(/^(\d+)\s+(.+)$/);
  assert(match, `Process ${pid} is no longer available`);
  return { parent: Number(match[1]), command: match[2] };
}

function listener(application, port) {
  const info = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8" });
  const pids = [...new Set([...info.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])))];
  assert.equal(pids.length, 1, `Expected one ${application} listener on ${port}`);
  const pid = pids[0];
  const cwd = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" }).match(/^n(.+)$/m)?.[1];
  assert.equal(cwd, resolve(root, "apps", application), "Refusing to touch a process outside this workspace");
  const ancestors = [];
  for (let ancestor = pid; ancestor > 1 && ancestors.length < 5;) {
    const record = command(ancestor);
    ancestors.push(record.command);
    ancestor = record.parent;
  }
  const expected = application === "api" ? /@nestjs\/cli\/bin\/nest\.js start --watch/ : /next\/dist\/bin\/next dev --webpack/;
  assert(ancestors.some((value) => expected.test(value)), `Expected a dev watcher, not a production ${application} server`);
  return { pid, cwd, ancestors };
}

async function waitFor(url, check) {
  const start = Date.now();
  let lastFailure = "No response";
  while (Date.now() - start < 25000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const text = await response.text();
      if (response.ok && check(text)) return { status: response.status, elapsedMs: Date.now() - start };
      lastFailure = `HTTP ${response.status} with unexpected result`;
    } catch (error) { lastFailure = error.message; }
    await new Promise((accept) => setTimeout(accept, 300));
  }
  throw new Error(`Reload timed out: ${url}; ${lastFailure}`);
}

async function save(file, text, atomic) {
  if (atomic) {
    const temporary = file + ".f01-reload.tmp";
    let created = false;
    try {
      await writeFile(temporary, text, { flag: "wx" });
      created = true;
      await rename(temporary, file);
    } finally { if (created) await rm(temporary, { force: true }); }
  } else await writeFile(file, text);
}

// Validate process ownership and dev mode before changing either source file.
evidence.before = { api: listener("api", 3656), web: listener("web", 3655), apiSha256: hash(original.api), webSha256: hash(original.web) };
assert(original.api.includes('database: "not-configured"'));
assert(original.web.includes("<h1>AIJ Foundation</h1>"));
await mkdir(resolve(root, ".artifacts/f01-closeout"), { recursive: true });
try {
  for (const atomic of [false, true]) {
    const marker = `F01-RELOAD-${atomic ? "ATOMIC" : "WRITE"}-${Date.now()}`;
    assert.equal(await readFile(apiFile, "utf8"), last.api, "Concurrent API writer; refusing to overwrite");
    const apiText = original.api.replace('database: "not-configured"', `database: "not-configured", reloadProbe: "${marker}"`);
    await save(apiFile, apiText, atomic);
    last.api = apiText;
    const api = await waitFor("http://127.0.0.1:3656/api/health", (text) => {
      const body = JSON.parse(text);
      return body.data?.reloadProbe === marker && body.data.scope === "process" && body.data.database === "not-configured";
    });
    assert.equal(await readFile(webFile, "utf8"), last.web, "Concurrent Web writer; refusing to overwrite");
    const webText = original.web.replace("<h1>AIJ Foundation</h1>", `<h1>AIJ Foundation ${marker}</h1>`);
    await save(webFile, webText, atomic);
    last.web = webText;
    const web = await waitFor("http://127.0.0.1:3655/", (text) => text.includes(marker) && text.includes("已连接 AIJ API"));
    const record = { at: new Date().toISOString(), save: atomic ? "atomic rename" : "writeFile", marker, api, web, listeners: { api: listener("api", 3656), web: listener("web", 3655) } };
    evidence.rounds.push(record);
    console.log(JSON.stringify(record));
  }
} catch (error) {
  evidence.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  for (const [name, file] of [["api", apiFile], ["web", webFile]]) {
    assert.equal(await readFile(file, "utf8"), last[name], `Concurrent ${name} writer; refusing to restore over their change`);
    await writeFile(file, original[name]);
  }
  await waitFor("http://127.0.0.1:3656/api/health", (text) => {
    const body = JSON.parse(text);
    return body.data?.scope === "process" && body.data.database === "not-configured" && !("reloadProbe" in body.data);
  });
  await waitFor("http://127.0.0.1:3655/", (text) => text.includes("已连接 AIJ API") && !text.includes("F01-RELOAD-"));
  assert.equal(hash(await readFile(apiFile, "utf8")), evidence.before.apiSha256);
  assert.equal(hash(await readFile(webFile, "utf8")), evidence.before.webSha256);
  evidence.restored = true;
  evidence.finishedAt = new Date().toISOString();
  evidence.after = { api: listener("api", 3656), web: listener("web", 3655) };
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Real dev reload evidence saved: ${output}; both source files restored`);
}
