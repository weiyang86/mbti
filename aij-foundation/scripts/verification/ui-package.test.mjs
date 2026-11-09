import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { repositoryRoot } from "./registry.mjs";

const packageDirectory = join(repositoryRoot, "packages/ui");
const webRequire = createRequire(join(repositoryRoot, "apps/web/package.json"));
const uiRequire = webRequire("@aij/ui");
const uiRequirePath = webRequire.resolve("@aij/ui");
const uiImport = await import(new URL("../../packages/ui/dist/index.mjs", import.meta.url));
const react = webRequire("react");
const renderToStaticMarkup = webRequire("react-dom/server").renderToStaticMarkup;

test("UI package publishes stable private runtime and React type exports from one source", async () => {
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  const declaration = await readFile(join(packageDirectory, "dist/index.d.ts"), "utf8");
  assert.equal(manifest.name, "@aij/ui");
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, "UNLICENSED");
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(manifest.peerDependencies.react, "^19.2.0");
  assert.equal(manifest.exports["."].import.default, "./dist/index.mjs");
  assert.equal(manifest.exports["."].require.default, "./dist/index.cjs");
  assert.equal(manifest.exports["."].import.types, "./dist/index.d.mts");
  assert.equal(manifest.exports["."].require.types, "./dist/index.d.cts");
  for (const file of ["index.mjs", "index.cjs", "index.d.ts", "index.d.mts", "index.d.cts"]) {
    await readFile(join(packageDirectory, "dist", file));
  }
  assert.match(declaration, /PageHeadingProps/);
  assert.match(declaration, /export declare function PageHeading/);
  assert.match(declaration, /ReactNode/);
});

test("actual Web workspace resolution loads the package CommonJS export", () => {
  const relativePath = relative(repositoryRoot, resolve(uiRequirePath));
  assert.match(relativePath, /(?:packages\/ui|node_modules\/\.pnpm|node_modules\/@aij\/ui)\/.*dist\/index\.cjs$/);
  assert.equal(typeof uiRequire.PageHeading, "function");
  assert.equal(typeof uiImport.PageHeading, "function");
});

test("ESM and CommonJS PageHeading exports render the shared heading and optional actions", () => {
  const props = {
    eyebrow: "e <",
    title: "Workspace",
    description: "A & B",
    actions: react.createElement("button", { type: "button" }, "Open")
  };
  const expected = '<div class="admin-page-heading admin-heading-actions"><div><p class="eyebrow">e &lt;</p><h1>Workspace</h1><p>A &amp; B</p></div><button type="button">Open</button></div>';
  assert.equal(renderToStaticMarkup(react.createElement(uiImport.PageHeading, props)), expected);
  assert.equal(renderToStaticMarkup(react.createElement(uiRequire.PageHeading, props)), expected);
  assert.equal(renderToStaticMarkup(react.createElement(uiImport.PageHeading, { eyebrow: "Client", title: "Home" })), '<div class="admin-page-heading"><div><p class="eyebrow">Client</p><h1>Home</h1></div></div>');
});

test("Web admin and client headings consume one public package without copied components", async () => {
  const consumers = [
    "admin-users.tsx", "admin-audit-logs.tsx", "admin-secrets.tsx", "admin-configuration.tsx",
    "admin-roles.tsx", "admin-dictionaries.tsx", "admin-files.tsx", "admin-shell.tsx", "client-workspaces.tsx"
  ];
  for (const name of consumers) {
    const source = await readFile(join(repositoryRoot, "apps/web/app/components", name), "utf8");
    assert.match(source, /import \{ PageHeading \} from "@aij\/ui";/, `${name} imports the public package`);
    assert.doesNotMatch(source, /<div className="admin-page-heading/, `${name} does not keep an inline duplicate`);
  }
  const source = await readFile(join(packageDirectory, "src/index.ts"), "utf8");
  assert.equal((source.match(/export function PageHeading/g) ?? []).length, 1);
  assert.doesNotMatch(source, /fetch\(|Prisma|Service|adminApi/);
});
