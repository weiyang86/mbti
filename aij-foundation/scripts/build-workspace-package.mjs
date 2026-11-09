import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

const requested = process.argv[2];
if (!requested || isAbsolute(requested)) throw new Error("Usage: node scripts/build-workspace-package.mjs packages/<name>");
const packageDirectory = resolve(repositoryRoot, requested);
const packageRelative = relative(resolve(repositoryRoot, "packages"), packageDirectory);
assert(packageRelative && !packageRelative.startsWith(".."), "Only workspace packages may be built here");
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
assert.match(manifest.name, /^@aij\/[a-z0-9-]+$/);
assert.equal(manifest.private, true);
assert.equal(manifest.license, "UNLICENSED");

const sourcePath = join(packageDirectory, "src", "index.ts");
const sourceDirectory = dirname(sourcePath);
const outputDirectory = join(packageDirectory, "dist");
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const declarationDirectory = join(outputDirectory, ".declarations");
mkdirSync(declarationDirectory, { recursive: true });
const program = ts.createProgram([sourcePath], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  declaration: true,
  emitDeclarationOnly: true,
  strict: true,
  skipLibCheck: true,
  types: manifest.devDependencies?.["@types/node"] ? ["node"] : [],
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  rootDir: dirname(sourcePath),
  outDir: declarationDirectory
});
const diagnostics = [...ts.getPreEmitDiagnostics(program)];
const emitted = program.emit(undefined, undefined, undefined, true);
diagnostics.push(...emitted.diagnostics);
const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
  getCurrentDirectory: () => repositoryRoot, getCanonicalFileName: (value) => value, getNewLine: () => "\n"
}));
// Build the reachable source graph, including relative modules. Each public
// module condition gets matching runtime and declaration references.
const sources = program.getSourceFiles().filter(file => !file.isDeclarationFile &&
  !relative(sourceDirectory, file.fileName).startsWith("..") && !isAbsolute(relative(sourceDirectory, file.fileName)));
const sourceNames = new Set(sources.map(file => resolve(file.fileName)));
const printer = ts.createPrinter();
function rewriteRelativeModules(containingFile, extension) {
  return context => {
    const visit = node => {
      const parent = node.parent;
      const isSpecifier = parent && ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node ||
        ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent) ||
        ts.isCallExpression(parent) && parent.arguments[0] === node &&
        (parent.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(parent.expression) && parent.expression.text === "require"));
      if (ts.isStringLiteral(node) && isSpecifier && node.text.startsWith(".")) {
        const target = ts.resolveModuleName(node.text, containingFile, program.getCompilerOptions(), ts.sys).resolvedModule;
        if (target && sourceNames.has(resolve(target.resolvedFileName))) {
          let name = relative(dirname(containingFile), target.resolvedFileName).replaceAll("\\", "/").replace(/\.tsx?$/, extension);
          if (!name.startsWith(".")) name = "./" + name;
          return context.factory.createStringLiteral(name);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return file => ts.visitNode(file, visit);
  };
}
const outputs = [];
for (const file of sources) {
  const stem = relative(sourceDirectory, file.fileName).replace(/\.tsx?$/, "");
  for (const [module, extension] of [[ts.ModuleKind.ES2022, ".mjs"], [ts.ModuleKind.CommonJS, ".cjs"]]) {
    const result = ts.transpileModule(file.text, {
      fileName: file.fileName,
      compilerOptions: { module, target: ts.ScriptTarget.ES2022, strict: true, esModuleInterop: true },
      transformers: { before: [rewriteRelativeModules(file.fileName, extension)] }, reportDiagnostics: true
    });
    assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, "Module transpilation failed");
    const name = stem + extension;
    mkdirSync(dirname(join(outputDirectory, name)), { recursive: true });
    writeFileSync(join(outputDirectory, name), result.outputText); outputs.push("dist/" + name);
  }
  const declaration = readFileSync(join(declarationDirectory, stem + ".d.ts"), "utf8");
  for (const [extension, suffix] of [[".js", ".d.ts"], [".mjs", ".d.mts"], [".cjs", ".d.cts"]]) {
    const parsed = ts.createSourceFile(file.fileName, declaration, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const transformed = ts.transform(parsed, [rewriteRelativeModules(file.fileName, extension)]);
    try { writeFileSync(join(outputDirectory, stem + suffix), printer.printFile(transformed.transformed[0])); }
    finally { transformed.dispose(); }
    outputs.push("dist/" + stem + suffix);
  }
}
rmSync(declarationDirectory, { recursive: true, force: true });
console.log(JSON.stringify({ package: manifest.name, outputs }));
