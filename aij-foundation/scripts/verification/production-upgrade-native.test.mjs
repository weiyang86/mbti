import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

test("paired Next and actual native Sharp load and render benign SVG on this host", async () => {
  const web = createRequire(fileURLToPath(new URL("../../apps/web/package.json", import.meta.url)));
  const next = createRequire(web.resolve("next/package.json"));
  const root = createRequire(fileURLToPath(new URL("../../package.json", import.meta.url)));
  assert.equal(web("next/package.json").version, "16.4.1");
  assert.equal(JSON.parse(readFileSync(resolve(dirname(root.resolve("eslint-config-next")), "../package.json"))).version, "16.4.1");
  assert.equal(web("react/package.json").version, "19.2.6");
  const sharp = next("sharp");
  assert.equal(sharp.versions.sharp, "0.35.5");
  const result = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#315d3e"/></svg>')).png().toBuffer();
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 12);
  assert.equal(metadata.format, "png");
});
