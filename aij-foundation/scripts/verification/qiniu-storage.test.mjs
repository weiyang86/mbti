import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { inspect } from "node:util";

const require = createRequire(resolve("apps/api/package.json"));
require("ts-node").register({ project: resolve("apps/api/tsconfig.json") });
const { QiniuStorageAdapter, qiniuHash, QiniuStorageError } = require(resolve("apps/api/src/files/qiniu-storage.adapter.ts"));
const { LocalStorageError } = require("@aij/runtime-contracts");
const { QiniuHttpsTransport, isQiniuPublicIpv4 } = require(resolve("apps/api/src/files/qiniu-storage-policy.ts"));
const key = "96f92477-75e0-4eec-8eef-3dd4b38dd5c9";
const otherKey = "96f92477-75e0-4eec-8eef-3dd4b38dd5c8";
const path = "alpha/test/objects/" + key;
const helloHash = "Fqr0xh3cxeii2r7eDztILNmuqUNN";
const now = 1793844000000;
const options = {
  productId: "alpha", environment: "test", bucket: "aij-synthetic", privateBucket: true,
  region: "z0", uploadOrigin: "https://up-z0.qiniup.com", managementOrigin: "https://rs-z0.qiniuapi.com",
  downloadOrigin: "https://files.example.com", allowedHosts: ["up-z0.qiniup.com", "rs-z0.qiniuapi.com", "files.example.com"]
};
// No stored credentials: each test instance gets independent random, synthetic keys.
function fixture(handler, config = options, resolver) {
  const credentials = { accessKey: randomBytes(24).toString("base64url"), secretKey: randomBytes(30).toString("base64url") };
  const calls = [];
  const scopes = [];
  const adapter = new QiniuStorageAdapter(config, resolver ?? (async (scope) => { scopes.push(scope); return credentials; }), {
    now: () => now, transport: { async send(input) { calls.push(input); return handler(input, credentials); } }
  });
  return { adapter, credentials, calls, scopes };
}
function json(value, status = 200) { return { status, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify(value)) }; }
function errorCode(code, outcome) {
  return (error) => {
    assert.ok(error instanceof LocalStorageError);
    assert.equal(error.code, code);
    if (outcome) { assert.ok(error instanceof QiniuStorageError); assert.equal(error.outcome, outcome); }
    return true;
  };
}
const safe64 = (data) => Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const sign = (data, credentials) => credentials.accessKey + ":" + safe64(createHmac("sha1", credentials.secretKey).update(data).digest());

test("actual-byte qetag vectors: empty, hello, exact 4MiB, 4MiB+1 and 5MiB", () => {
  const vectors = [
    [Buffer.alloc(0), "Fto5o-5ea0sNMlW_75VgGJCv2AcJ"], [Buffer.from("hello"), helloHash],
    [Buffer.alloc(4194304), "FivMvS848VwT631aif2dhfWV4jvD"],
    [Buffer.alloc(4194305), "lhCFgki5yzon0rjN9uJusf6qtsF6"],
    [Buffer.alloc(5242880, "a"), "ltpe0LzGjhrecjMswcK8d-Q1u47h"]
  ];
  for (const [bytes, expected] of vectors) assert.equal(qiniuHash(bytes), expected);
});

test("callable shared StorageAdapter signs exact insert-only multipart upload and checks receipt", async () => {
  const f = fixture(() => json({ key: path, hash: helloHash }));
  assert.equal(f.adapter.relativePath(key), path);
  assert.deepEqual(await f.adapter.write(key, Buffer.from("hello")), { path, size: 5 });
  assert.equal(f.calls.length, 1);
  const request = f.calls[0];
  const body = Buffer.from(request.body).toString();
  assert.equal(request.url, options.uploadOrigin + "/");
  assert.equal(request.method, "POST");
  assert.equal(body.includes('name="file"; filename="object"'), true);
  const token = body.match(/name="token"\r\n\r\n([^\r]+)\r\n/)[1];
  const [ak, digest, encoded] = token.split(":");
  assert.equal(ak + ":" + digest, sign(encoded, f.credentials));
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url")), {
    scope: options.bucket + ":" + path, deadline: now / 1000 + 300,
    insertOnly: 1, fsizeLimit: 5, returnBody: '{"key":"$(key)","hash":"$(etag)"}'
  });
  assert.equal(body.includes("\r\nhello\r\n"), true);
  assert.deepEqual(f.scopes, [{ productId: "alpha", environment: "test", bucket: options.bucket, operation: "write" }]);
});

test("write snapshots only the supplied byte view before awaiting trusted resolver", async () => {
  let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  const bytes = Buffer.from("xxhellozz");
  const credentials = { accessKey: randomBytes(16).toString("hex"), secretKey: randomBytes(16).toString("hex") };
  const f = fixture((request) => {
    const body = Buffer.from(request.body).toString();
    assert.equal(body.includes("\r\nhello\r\n"), true);
    assert.equal(body.includes("xxhello"), false);
    return json({ key: path, hash: helloHash });
  }, options, async () => { await gate; return credentials; });
  const pending = f.adapter.write(key, bytes.subarray(2, 7));
  bytes.fill(0);
  release();
  await pending;
});

for (const [label, receipt] of [
  ["wrong exact key", { key: "beta/test/objects/" + key, hash: helloHash }],
  ["wrong hash", { key: path, hash: "Fto5o-5ea0sNMlW_75VgGJCv2AcJ" }],
  ["malformed hash", { key: path, hash: "x".repeat(28) }], ["missing receipt", {}]
]) {
  test(`upload ${label} is unknown and never retries or deletes`, async () => {
    const f = fixture(() => json(receipt));
    await assert.rejects(f.adapter.write(key, Buffer.from("hello")), errorCode("STORAGE_WRITE_FAILED", "unknown"));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, "POST");
  });
}
for (const [status, outcome, code] of [[614, "rejected", "OBJECT_EXISTS"], [401, "rejected", "STORAGE_WRITE_FAILED"],
  [403, "rejected", "STORAGE_WRITE_FAILED"], [408, "unknown", "STORAGE_WRITE_FAILED"],
  [500, "unknown", "STORAGE_WRITE_FAILED"], [579, "unknown", "STORAGE_WRITE_FAILED"], [599, "unknown", "STORAGE_WRITE_FAILED"]]) {
  test(`upload HTTP ${status} maps safely with one attempt`, async () => {
    const f = fixture(() => json({ error: "untrusted vendor text" }, status));
    await assert.rejects(f.adapter.write(key, Buffer.from("hello")), errorCode(code, outcome));
    assert.equal(f.calls.length, 1);
  });
}

test("private signed URLs bind host, path and short expiry; cannot inject query or ttl", async () => {
  const f = fixture(() => { throw new Error("must not use network"); });
  const url = await f.adapter.signedGetUrl(key, 17);
  const unsigned = options.downloadOrigin + "/" + path + "?e=" + (now / 1000 + 17);
  assert.equal(url, unsigned + "&token=" + sign(unsigned, f.credentials));
  assert.notEqual(await f.adapter.signedGetUrl(otherKey, 17), url);
  assert.equal(f.calls.length, 0);
  for (const ttl of [0, 301, -1, NaN, 1.1, "60"]) await assert.rejects(f.adapter.signedGetUrl(key, ttl), errorCode("STORAGE_READ_FAILED", "not_attempted"));
});

test("stat/delete use current Qiniu v2 management signature, date and exact encoded entry", async () => {
  const f = fixture((request, credentials) => {
    const url = new URL(request.url);
    const operation = request.method === "GET" ? "stat" : "delete";
    assert.equal(url.pathname, "/" + operation + "/" + safe64(options.bucket + ":" + path));
    assert.equal(request.headers["X-Qiniu-Date"], "20261105T020000Z");
    const canonical = `${request.method} ${url.pathname}\nHost: ${url.host}\nContent-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: ${request.headers["X-Qiniu-Date"]}\n\n`;
    assert.equal(request.headers.Authorization, "Qiniu " + sign(canonical, credentials));
    assert.equal(request.body, undefined);
    return operation === "stat" ? json({ fsize: 5, hash: helloHash }) : { status: 200, headers: {}, body: Buffer.alloc(0) };
  });
  assert.equal(await f.adapter.exists(key), true);
  await f.adapter.remove(key);
  assert.equal(f.calls.length, 2);
});

test("read verifies stat size and qetag and returns a detached byte copy", async () => {
  const responseBytes = Buffer.from("hello");
  const f = fixture((request, credentials) => {
    if (request.url.startsWith(options.managementOrigin)) return json({ fsize: 5, hash: helloHash });
    const [unsigned, token] = request.url.split("&token=");
    assert.equal(token, sign(unsigned, credentials));
    return { status: 200, headers: {}, body: responseBytes };
  });
  const read = await f.adapter.read(key);
  responseBytes.fill(0);
  assert.equal(read.toString(), "hello");
  assert.equal(f.calls.length, 2);
});

test("missing object is explicit; management 404, outages and corrupt metadata are errors", async () => {
  const absent = fixture(() => json({ error: "no such file" }, 612));
  assert.equal(await absent.adapter.exists(key), false);
  await assert.rejects(absent.adapter.read(key), errorCode("OBJECT_MISSING"));
  await assert.rejects(absent.adapter.remove(key), errorCode("OBJECT_MISSING"));
  for (const status of [401, 403, 404, 500, 599, 631]) {
    const f = fixture(() => json({ error: "vendor error" }, status));
    await assert.rejects(f.adapter.exists(key), errorCode("STORAGE_READ_FAILED"));
    assert.equal(f.calls.length, 1);
  }
  for (const metadata of [{}, { fsize: -1, hash: helloHash }, { fsize: 5242881, hash: helloHash },
    { fsize: 5, hash: "bad" }, { fsize: "5", hash: helloHash }, []]) {
    const f = fixture(() => json(metadata));
    await assert.rejects(f.adapter.exists(key), errorCode("OBJECT_INVALID"));
  }
});

for (const [label, body, status, code] of [["wrong hash", "jello", 200, "OBJECT_INVALID"],
  ["wrong size", "hello!", 200, "OBJECT_INVALID"], ["missing", "", 404, "OBJECT_MISSING"],
  ["outage", "untrusted", 503, "STORAGE_READ_FAILED"], ["wrong signature", "", 401, "STORAGE_READ_FAILED"]]) {
  test(`download ${label} is rejected without retries`, async () => {
    const f = fixture((request) => request.url.startsWith(options.managementOrigin) ? json({ fsize: 5, hash: helloHash }) : { status, headers: {}, body: Buffer.from(body) });
    await assert.rejects(f.adapter.read(key), errorCode(code));
    assert.equal(f.calls.length, 2);
  });
}

test("uncertain upload/delete transport errors and invalid delete receipt remain unknown without retry", async () => {
  for (const operation of ["write", "remove"]) {
    const f = fixture(() => { throw new Error("native timeout with sensitive URL"); });
    await assert.rejects(f.adapter[operation](key, Buffer.from("hello")), errorCode(operation === "write" ? "STORAGE_WRITE_FAILED" : "STORAGE_DELETE_FAILED", "unknown"));
    assert.equal(f.calls.length, 1);
  }
  const bad = fixture(() => json({ error: "not a delete receipt" }));
  await assert.rejects(bad.adapter.remove(key), errorCode("STORAGE_DELETE_FAILED", "unknown"));
  assert.equal(bad.calls.length, 1);
  for (const status of [201, 204, 298]) {
    for (const operation of ["write", "remove"]) {
      const f = fixture(() => json({}, status));
      await assert.rejects(f.adapter[operation](key, Buffer.from("hello")), errorCode(operation === "write" ? "STORAGE_WRITE_FAILED" : "STORAGE_DELETE_FAILED", "unknown"));
      assert.equal(f.calls.length, 1, "unexpected success status may follow acceptance; no retry");
    }
  }
});

test("secrets, vendor bodies and native causes never appear in adapter/errors", async () => {
  const marker = randomBytes(20).toString("hex");
  const f = fixture(() => { throw new Error(marker); });
  try { await f.adapter.write(key, Buffer.from("hello")); assert.fail("expected failure"); }
  catch (error) {
    const visible = inspect(error) + JSON.stringify(error) + inspect(f.adapter);
    for (const secret of [marker, f.credentials.accessKey, f.credentials.secretKey]) assert.equal(visible.includes(secret), false);
    assert.equal("cause" in error, false);
  }
  const failed = fixture(() => assert.fail("network forbidden"), options, async () => { throw new Error(marker); });
  await assert.rejects(failed.adapter.exists(key), (error) => {
    assert.equal(error.outcome, "not_attempted"); assert.equal(inspect(error).includes(marker), false); return true;
  });
  assert.equal(failed.calls.length, 0);
});

test("invalid resolver results and malformed vendor JSON fail safely", async () => {
  for (const value of [undefined, {}, { accessKey: undefined, secretKey: undefined }, { accessKey: 12345678, secretKey: 12345678 }, { accessKey: "bad\r\nkey", secretKey: "bad\r\nkey" }]) {
    const f = fixture(() => assert.fail("network forbidden"), options, async () => value);
    await assert.rejects(f.adapter.write(key, Buffer.from("hello")), errorCode("STORAGE_WRITE_FAILED", "not_attempted"));
    assert.equal(f.calls.length, 0);
  }
  for (const response of [
    { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("vendor debug") },
    { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{") },
    { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from([0xff]) },
    json(null), json([]), { status: 200, headers: {}, body: Buffer.alloc(16385) }
  ]) {
    const f = fixture(() => response);
    await assert.rejects(f.adapter.write(key, Buffer.from("hello")), errorCode("STORAGE_WRITE_FAILED", "unknown"));
    assert.equal(f.calls.length, 1);
  }
});

test("UUID, namespace, size and endpoint validation reject before credential/network access", async () => {
  const f = fixture(() => assert.fail("network forbidden"), options, async () => assert.fail("resolver forbidden"));
  for (const invalid of ["../x", key + "?e=1", key + "/x", key.toUpperCase(), "https://elsewhere.example/x", "", null]) {
    assert.throws(() => f.adapter.relativePath(invalid), errorCode("OBJECT_KEY_INVALID"));
    for (const op of ["read", "write", "exists", "remove", "signedGetUrl"]) await assert.rejects(f.adapter[op](invalid, Buffer.alloc(0)), errorCode("OBJECT_KEY_INVALID"));
  }
  await assert.rejects(f.adapter.write(key, Buffer.alloc(5242881)), errorCode("STORAGE_WRITE_FAILED", "not_attempted"));
  for (const override of [
    { productId: "../x" }, { productId: "a".repeat(65) }, { environment: "staging" }, { bucket: "bad:scope" },
    { privateBucket: false }, { region: "any" }, { signedUrlTtlSeconds: 301 }, { maxObjectBytes: 5242881 },
    { uploadOrigin: "https://up-z1.qiniup.com" }, { managementOrigin: "https://rs.qiniuapi.com" },
    ...["http://files.example.com", "https://files.example.com/", "https://files.example.com?x=y", "https://user:pass@files.example.com", "https://files.example.com:443", "https://127.0.0.1", "https://[::ffff:127.0.0.1]", "https://files.example.com.evil.com"].map((downloadOrigin) => ({ downloadOrigin })),
    { allowedHosts: ["*.example.com"] }, { allowedHosts: ["localhost"] }, { timeoutMs: 30001 }
  ]) assert.throws(() => fixture(() => json({}), { ...options, ...override }), errorCode("STORAGE_ROOT_INVALID"));
  assert.equal(f.calls.length, 0);
});

test("products and environments produce distinct logical keys; config is snapshotted", () => {
  const config = { ...options, allowedHosts: [...options.allowedHosts] };
  const f = fixture(() => json({}), config);
  config.productId = "changed"; config.allowedHosts.length = 0;
  assert.equal(f.adapter.relativePath(key), path);
  assert.notEqual(fixture(() => json({}), { ...options, productId: "beta" }).adapter.relativePath(key), path);
  assert.notEqual(fixture(() => json({}), { ...options, environment: "production" }).adapter.relativePath(key), path);
});

test("IPv4 public policy conservatively rejects all special networks and mapped IPv6", () => {
  for (const ip of ["0.0.0.0", "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.0.0.9", "192.0.2.1", "192.88.99.1", "192.31.196.1", "192.52.193.1", "192.175.48.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::1", "::ffff:93.184.216.34", "::ffff:127.0.0.1", "2001:4860:4860::8888", "2130706433", "0177.0.0.1", "0x7f000001"]) assert.equal(isQiniuPublicIpv4(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "100.128.0.1", "172.32.0.1"]) assert.equal(isQiniuPublicIpv4(ip), true, ip);
});

test("production transport rejects nonpublic/mixed/rebinding DNS before any request socket", async () => {
  const input = { url: "https://files.example.com/x", method: "GET", headers: {}, maxResponseBytes: 10 };
  for (const addresses of [[], ["127.0.0.1"], ["93.184.216.34", "10.0.0.1"], ["::ffff:127.0.0.1"], ["169.254.169.254"]]) {
    let sockets = 0;
    const transport = new QiniuHttpsTransport(["files.example.com"], 100, {
      resolve4: async () => addresses, request: () => { sockets++; assert.fail("socket forbidden"); }
    });
    await assert.rejects(transport.send(input), (error) => error.reason === "policy");
    assert.equal(sockets, 0);
  }
  let lookups = 0;
  const transport = new QiniuHttpsTransport(["files.example.com"], 100, {
    resolve4: async () => ++lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"],
    request: () => { throw new Error("synthetic unavailable"); }
  });
  await assert.rejects(transport.send(input), (error) => error.reason === "network");
  await assert.rejects(transport.send(input), (error) => error.reason === "policy");
  assert.equal(lookups, 2);
});

test("transport rejects routing/framing/header URL injection without DNS or socket", async () => {
  const transport = new QiniuHttpsTransport(["files.example.com"], 100, { resolve4: async () => assert.fail("DNS forbidden"), request: () => assert.fail("socket forbidden") });
  const input = { url: "https://files.example.com/x", method: "GET", headers: {}, maxResponseBytes: 10 };
  for (const override of [
    ...["http://files.example.com/x", "https://127.0.0.1/x", "https://[::ffff:127.0.0.1]/x", "https://user:pass@files.example.com/x", "https://files.example.com:443/x", "https://files.example.com/x#part", "https://files.example.com.evil.com/x"].map((url) => ({ url })),
    { headers: { Host: "localhost" } }, { headers: { Authorization: "x\r\nHost: localhost" } },
    { headers: { "Content-Length": "1" } }, { method: "PUT" }, { maxResponseBytes: 5242881 }, { body: Buffer.alloc(5260000) }
  ]) await assert.rejects(transport.send({ ...input, ...override }), (error) => error.reason === "policy");
});
