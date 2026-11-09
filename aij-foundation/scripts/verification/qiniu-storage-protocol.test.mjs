import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import test from "node:test";

const require = createRequire(resolve("apps/api/package.json"));
require("ts-node").register({ project: resolve("apps/api/tsconfig.json") });
const { QiniuStorageAdapter } = require(resolve("apps/api/src/files/qiniu-storage.adapter.ts"));
const { QiniuHttpsTransport } = require(resolve("apps/api/src/files/qiniu-storage-policy.ts"));
const { LocalStorageError } = require("@aij/runtime-contracts");
const hosts = ["up-z0.qiniup.com", "rs-z0.qiniuapi.com", "files.example.com"];
const credentials = { accessKey: randomBytes(24).toString("base64url"), secretKey: randomBytes(30).toString("base64url") };
const options = { productId: "protocol", environment: "test", bucket: "aij-synthetic", privateBucket: true, region: "z0",
  uploadOrigin: "https://" + hosts[0], managementOrigin: "https://" + hosts[1], downloadOrigin: "https://" + hosts[2], allowedHosts: hosts };
const safe64 = (data) => Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const sign = (text) => credentials.accessKey + ":" + safe64(createHmac("sha1", credentials.secretKey).update(text).digest());
// Independent fixture implementation (never call the adapter hash/sign helpers).
function fixtureHash(bytes) {
  const hashes = [];
  for (let at = 0; at < Math.max(1, bytes.length); at += 4194304) hashes.push(createHash("sha1").update(bytes.subarray(at, at + 4194304)).digest());
  return safe64(Buffer.concat([Buffer.from([hashes.length > 1 ? 150 : 22]), hashes.length > 1 ? createHash("sha1").update(Buffer.concat(hashes)).digest() : hashes[0]]));
}
const objects = new Map();
const observations = { requests: 0, uploads: 0, deletes: 0, dns: 0, sockets: 0, pinChecks: 0 };
let mode = "normal";
let server;
let port;
let certificate;
let scratch;
const failures = [];
const sockets = new Set();
function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value));
}
function failCode(code, outcome) {
  return (error) => error instanceof LocalStorageError && error.code === code && (!outcome || error.outcome === outcome);
}
async function handler(req, res) {
  observations.requests++;
  const buffers = [];
  for await (const bytes of req) buffers.push(bytes);
  const body = Buffer.concat(buffers);
  if (req.url.startsWith("/transport/")) {
    const route = req.url.slice(11);
    if (route === "redirect") { res.writeHead(302, { Location: "https://127.0.0.1/must-never-follow" }); res.end(); }
    else if (route === "large-length") { res.writeHead(200, { "Content-Length": "100000" }); res.end("x"); }
    else if (route === "large-chunks") { res.writeHead(200); res.write("123456"); res.end("789012"); }
    else if (route === "timeout") { res.writeHead(200); res.write("x"); }
    else if (route === "compressed") { res.writeHead(200, { "Content-Encoding": "gzip" }); res.end("bad"); }
    else { res.writeHead(200); res.end("hello"); }
    return;
  }
  if (req.headers.host === hosts[0] && req.method === "POST" && req.url === "/") {
    observations.uploads++;
    const boundary = req.headers["content-type"]?.match(/^multipart\/form-data; boundary=([a-z0-9-]+)$/)?.[1];
    if (!boundary) { json(res, 400, {}); return; }
    const parts = body.toString("latin1").split("--" + boundary).slice(1, -1);
    const fields = new Map(parts.map((part) => {
      const name = part.match(/name="([^"]+)"/)[1];
      const start = part.indexOf("\r\n\r\n") + 4;
      return [name, Buffer.from(part.slice(start, -2), "latin1")];
    }));
    const token = fields.get("token").toString();
    const [ak, digest, encoded] = token.split(":");
    if (ak + ":" + digest !== sign(encoded)) { json(res, 401, {}); return; }
    const policy = JSON.parse(Buffer.from(encoded, "base64url"));
    const key = fields.get("key").toString();
    if (policy.scope !== options.bucket + ":" + key || policy.insertOnly !== 1 || policy.deadline < Date.now() / 1000) { json(res, 403, {}); return; }
    assert.deepEqual([...fields.keys()], ["key", "token", "file"]);
    assert.equal(policy.returnBody, '{"key":"$(key)","hash":"$(etag)"}');
    assert.equal(policy.fsizeLimit, fields.get("file").length);
    if (objects.has(key)) { json(res, 614, {}); return; }
    const content = Buffer.from(fields.get("file")); objects.set(key, content);
    if (mode === "upload-timeout") return; // Accepted, but acknowledgement lost.
    if (mode === "upload-no-receipt") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(); return; }
    if (mode === "upload-redirect") { res.writeHead(307, { Location: "https://files.example.com/" }); res.end(); return; }
    json(res, 200, { key: mode === "upload-wrong-key" ? key + "-wrong" : key,
      hash: mode === "upload-wrong-hash" ? fixtureHash(Buffer.from("wrong")) : fixtureHash(content) });
    return;
  }
  if (req.headers.host === hosts[1]) {
    const canonical = `${req.method} ${req.url}\nHost: ${req.headers.host}\nContent-Type: ${req.headers["content-type"]}\nX-Qiniu-Date: ${req.headers["x-qiniu-date"]}\n\n`;
    if (req.headers.authorization !== "Qiniu " + sign(canonical)) { json(res, 401, {}); return; }
    assert.equal(body.length, 0);
    assert.match(req.headers["x-qiniu-date"], /^\d{8}T\d{6}Z$/);
    const [unused, operation, entry] = req.url.split("/");
    assert.equal(unused, "");
    const decoded = Buffer.from(entry, "base64url").toString();
    assert.equal(decoded.startsWith(options.bucket + ":protocol/test/objects/"), true);
    const key = decoded.slice(options.bucket.length + 1);
    if (mode === "stat-outage" && operation === "stat") { json(res, 503, {}); return; }
    if (!objects.has(key)) { json(res, 612, {}); return; }
    if (operation === "stat" && req.method === "GET") {
      const bytes = objects.get(key);
      json(res, 200, mode === "stat-corrupt" ? { fsize: bytes.length, hash: "invalid" } : { fsize: bytes.length, hash: fixtureHash(bytes) });
    } else if (operation === "delete" && req.method === "POST") {
      observations.deletes++; objects.delete(key);
      if (mode === "delete-timeout") return;
      res.writeHead(200); res.end();
    } else json(res, 405, {});
    return;
  }
  if (req.headers.host === hosts[2] && req.method === "GET") {
    const unsigned = "https://" + hosts[2] + req.url.split("&token=")[0];
    const token = req.url.split("&token=")[1];
    if (token !== sign(unsigned) || Number(new URL(unsigned).searchParams.get("e")) < Date.now() / 1000) { json(res, 401, {}); return; }
    const key = new URL(unsigned).pathname.slice(1);
    if (mode === "download-outage") { json(res, 503, {}); return; }
    if (mode === "download-missing" || !objects.has(key)) { json(res, 404, {}); return; }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(mode === "download-corrupt" ? Buffer.from("corrupt") : objects.get(key));
    return;
  }
  json(res, 404, {});
}

test.before(async () => {
  await mkdir(resolve(".artifacts"), { recursive: true, mode: 0o700 });
  scratch = await mkdtemp(resolve(".artifacts/af147-protocol-"));
  const certPath = join(scratch, "certificate.pem");
  const keyPath = join(scratch, "key.pem");
  // Short-lived synthetic TLS identity, generated at runtime and always removed.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
    "-out", certPath, "-days", "1", "-subj", "/CN=files.example.com", "-addext", "subjectAltName=" + hosts.map((host) => "DNS:" + host).join(",")], { stdio: "ignore" });
  certificate = await readFile(certPath);
  server = createServer({ key: await readFile(keyPath), cert: certificate }, (req, res) => {
    void handler(req, res).catch((error) => { failures.push(error); res.destroy(); });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  port = server.address().port;
});
test.after(async () => {
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise((done) => server.close(done));
  await rm(scratch, { recursive: true, force: true });
  assert.deepEqual(failures, [], "synthetic protocol handler assertions");
  assert.ok(observations.pinChecks > 0);
});

function transport({ timeoutMs = 1000, tamper, wrongCertificate = false } = {}) {
  return new QiniuHttpsTransport(wrongCertificate ? ["wrong.example.com"] : hosts, timeoutMs, {
    async resolve4() { observations.dns++; return ["93.184.216.34"]; },
    request(requestOptions, callback) {
      observations.sockets++;
      assert.equal(requestOptions.agent, false);
      assert.equal(requestOptions.protocol, "https:");
      assert.equal(requestOptions.port, 443);
      assert.equal(requestOptions.family, 4);
      assert.equal(requestOptions.rejectUnauthorized, true);
      assert.equal(requestOptions.servername, requestOptions.hostname);
      requestOptions.lookup(requestOptions.hostname, { all: false }, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, "93.184.216.34"); assert.equal(family, 4); observations.pinChecks++;
      });
      requestOptions.lookup(requestOptions.hostname, { all: true }, (error, entries) => {
        assert.equal(error, null); assert.deepEqual(entries, [{ address: "93.184.216.34", family: 4 }]); observations.pinChecks++;
      });
      // The ONLY loopback route is this per-instance injected test connector.
      // Keep production SNI/checkServerIdentity/rejectUnauthorized intact; add
      // only the generated CA and synthetic socket mapping. No env/global patch.
      return httpsRequest({ ...requestOptions, headers: { ...requestOptions.headers, Host: requestOptions.hostname },
        ...(tamper?.(requestOptions) ?? {}), ca: certificate, port,
        lookup: (_host, _options, done) => done(null, "127.0.0.1", 4) }, callback);
    }
  });
}
function adapter(settings) { return new QiniuStorageAdapter(options, async () => credentials, { transport: transport(settings) }); }
const requestInput = (route, maxResponseBytes = 10) => ({ url: "https://files.example.com/transport/" + route, method: "GET", headers: {}, maxResponseBytes });

test("real production HTTPS consumer and adapter round trip multipart/stat/private GET/delete", async () => {
  mode = "normal";
  const storage = adapter(); const key = randomUUID();
  const bytes = Buffer.from([0, 1, 2, 13, 10, 128, 255, ...Buffer.from("synthetic")]);
  const logical = "protocol/test/objects/" + key;
  const before = observations.requests;
  assert.deepEqual(await storage.write(key, bytes), { path: logical, size: bytes.length });
  assert.deepEqual(objects.get(logical), bytes);
  assert.equal(await storage.exists(key), true);
  assert.deepEqual(await storage.read(key), bytes);
  await assert.rejects(storage.write(key, Buffer.from("replacement")), failCode("OBJECT_EXISTS", "rejected"));
  assert.deepEqual(objects.get(logical), bytes);
  await storage.remove(key);
  assert.equal(await storage.exists(key), false);
  await assert.rejects(storage.read(key), failCode("OBJECT_MISSING"));
  assert.equal(observations.requests - before, 8);
});

test("multipart fixture handles exact max size and cross-block hash using actual bytes", async () => {
  mode = "normal"; const storage = adapter(); const key = randomUUID();
  const bytes = Buffer.alloc(5 * 1024 * 1024, "a");
  assert.equal(fixtureHash(bytes), "ltpe0LzGjhrecjMswcK8d-Q1u47h");
  await storage.write(key, bytes); assert.deepEqual(await storage.read(key), bytes); await storage.remove(key);
});

for (const fault of ["upload-wrong-key", "upload-wrong-hash", "upload-no-receipt", "upload-redirect", "upload-timeout"]) {
  test(`${fault}: accepted object survives unknown receipt and one POST only`, async () => {
    mode = fault; const key = randomUUID(); const storage = adapter({ timeoutMs: 100 });
    const before = { ...observations };
    await assert.rejects(storage.write(key, Buffer.from("accepted")), failCode("STORAGE_WRITE_FAILED", "unknown"));
    assert.equal(observations.uploads - before.uploads, 1);
    assert.equal(observations.deletes - before.deletes, 0);
    assert.equal(observations.requests - before.requests, 1);
    assert.equal(objects.get("protocol/test/objects/" + key).toString(), "accepted");
  });
}

test("accepted delete with lost acknowledgement stays unknown without retry", async () => {
  mode = "normal"; const storage = adapter({ timeoutMs: 100 }); const key = randomUUID();
  await storage.write(key, Buffer.from("delete"));
  mode = "delete-timeout"; const before = observations.requests;
  await assert.rejects(storage.remove(key), failCode("STORAGE_DELETE_FAILED", "unknown"));
  assert.equal(observations.requests - before, 1);
  assert.equal(objects.has("protocol/test/objects/" + key), false);
});

test("wrong upload signature and exact scope are rejected by actual protocol fixture", async () => {
  mode = "normal";
  // Alter the trusted resolver output only for this instance: fixture cannot
  // accept its tokens, proving actual signing is checked at the wire boundary.
  const invalid = new QiniuStorageAdapter(options, async () => ({ ...credentials, secretKey: randomBytes(30).toString("base64url") }), { transport: transport() });
  const key = randomUUID();
  await assert.rejects(invalid.write(key, Buffer.from("forbidden")), failCode("STORAGE_WRITE_FAILED", "rejected"));
  assert.equal(objects.has("protocol/test/objects/" + key), false);
  const normal = adapter(); const key2 = randomUUID(); await normal.write(key2, Buffer.from("keep"));
  await assert.rejects(invalid.remove(key2), failCode("STORAGE_DELETE_FAILED", "rejected"));
  assert.equal(objects.has("protocol/test/objects/" + key2), true);
  const network = transport();
  const wrongScope = new QiniuStorageAdapter(options, async () => credentials, { transport: {
    send(input) {
      const copy = Buffer.from(input.body);
      const marker = Buffer.from('name="key"\r\n\r\nprotocol/');
      const index = copy.indexOf(marker) + marker.length - "protocol/".length;
      assert.ok(index > 0);
      copy[index] = "x".charCodeAt(0); // Valid signed token, different multipart key.
      return network.send({ ...input, body: copy });
    }
  } });
  const key3 = randomUUID();
  await assert.rejects(wrongScope.write(key3, Buffer.from("forbidden")), failCode("STORAGE_WRITE_FAILED", "rejected"));
  assert.equal(objects.has("protocol/test/objects/" + key3), false);
});

test("wrong private GET signature returns read failure, never false/missing", async () => {
  mode = "normal"; const key = randomUUID(); await adapter().write(key, Buffer.from("keep"));
  const storage = adapter({ tamper: (input) => input.hostname === hosts[2] ? { path: input.path.replace("&token=", "&token=invalid") } : {} });
  await assert.rejects(storage.read(key), failCode("STORAGE_READ_FAILED"));
});

test("wire-level missing, outage, corrupt stat and corrupt download stay distinct", async () => {
  mode = "normal"; const key = randomUUID(); const storage = adapter(); await storage.write(key, Buffer.from("keep"));
  mode = "stat-outage"; await assert.rejects(storage.exists(key), failCode("STORAGE_READ_FAILED"));
  mode = "stat-corrupt"; await assert.rejects(storage.exists(key), failCode("OBJECT_INVALID"));
  mode = "download-outage"; await assert.rejects(storage.read(key), failCode("STORAGE_READ_FAILED"));
  mode = "download-corrupt"; await assert.rejects(storage.read(key), failCode("OBJECT_INVALID"));
  mode = "download-missing"; await assert.rejects(storage.read(key), failCode("OBJECT_MISSING"));
  mode = "normal"; assert.equal(await storage.exists(key), true);
});

for (const [route, reason] of [["redirect", "redirect"], ["large-length", "size"], ["large-chunks", "size"], ["timeout", "timeout"], ["compressed", "response"]]) {
  test(`production transport ${route} is bounded with no redirect/fallback/retry`, async () => {
    mode = "normal"; const before = observations.requests;
    await assert.rejects(transport({ timeoutMs: 100 }).send(requestInput(route)), (error) => error.reason === reason);
    assert.equal(observations.requests - before, 1);
  });
}

test("pinned target preserves original TLS hostname validation", async () => {
  const before = observations.requests;
  await assert.rejects(transport({ wrongCertificate: true }).send({ ...requestInput("ok"), url: "https://wrong.example.com/transport/ok" }), (error) => error.reason === "network");
  assert.equal(observations.requests, before, "certificate mismatch must stop before HTTP body/authentication");
});

test("DNS deadline cannot open a late socket; success consumes one validated answer only", async () => {
  let release;
  let opened = 0;
  const slow = new QiniuHttpsTransport(hosts, 20, { resolve4: () => new Promise((done) => { release = done; }), request: () => { opened++; assert.fail("late socket forbidden"); } });
  await assert.rejects(slow.send(requestInput("ok")), (error) => error.reason === "timeout");
  release(["93.184.216.34"]);
  await new Promise((done) => setImmediate(done));
  assert.equal(opened, 0);
  const before = { ...observations };
  assert.equal(Buffer.from((await transport().send(requestInput("ok"))).body).toString(), "hello");
  assert.equal(observations.dns - before.dns, 1);
  assert.equal(observations.sockets - before.sockets, 1);
  assert.equal(observations.pinChecks - before.pinChecks, 2);
});
