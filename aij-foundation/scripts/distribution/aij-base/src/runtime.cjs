"use strict";

const { execFileSync } = require("node:child_process");
const { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const packageInfo = Object.freeze({
  name: "@aij/base",
  version: "0.1.0",
  private: true,
  distribution: "LOCAL_PRIVATE_PACK_ONLY"
});

function archivePath() {
  return resolve(__dirname, "../template/aij-foundation.tgz");
}

function safeArchiveEntries(archive) {
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const entries = listing.split("\n").filter(Boolean);
  if (!entries.length) throw new Error("Packed project template is empty");
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (normalized.startsWith("/") || parts[0] !== "aij-foundation" || parts.some(part => part === "." || part === "..")) {
      throw new Error("Packed project template contains an unsafe path");
    }
  }
  const required = [
    "aij-foundation/package.json",
    "aij-foundation/pnpm-lock.yaml",
    "aij-foundation/pnpm-workspace.yaml",
    "aij-foundation/apps/api/package.json",
    "aij-foundation/apps/web/package.json"
  ];
  for (const file of required) if (!entries.includes(file)) throw new Error("Packed project template is incomplete");
  const verbose = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  for (const line of verbose.split("\n").filter(Boolean)) {
    if (!/^[d-]/.test(line)) throw new Error("Packed project template contains a link or special file");
  }
  return entries.filter(entry => !entry.endsWith("/")).length;
}

function assertSafeDestination(destination) {
  if (typeof destination !== "string" || !destination.trim()) throw new Error("A destination directory is required");
  const target = resolve(destination);
  if (target.split(/[\\/]/).includes("qingqi-ai-consultant")) throw new Error("Destination cannot enter the source product");
  let parent = dirname(target);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) throw new Error("Could not resolve destination parent");
    parent = next;
  }
  const realParent = realpathSync(parent);
  if (realParent.split(/[\\/]/).includes("qingqi-ai-consultant")) throw new Error("Destination cannot resolve into the source product");
  const safeTarget = resolve(realParent, ...target.slice(parent.length).split(/[\\/]/).filter(Boolean));
  if (existsSync(safeTarget)) throw new Error("Destination already exists; existing files were left untouched");
  return safeTarget;
}

function materializeProject({ destination } = {}) {
  const target = assertSafeDestination(destination);
  const archive = archivePath();
  const stat = lstatSync(archive);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Packed project template is unavailable");
  const fileCount = safeArchiveEntries(archive);
  mkdirSync(target, { recursive: false, mode: 0o700 });
  try {
    execFileSync("tar", ["-xzf", archive, "-C", target, "--strip-components=1"], { stdio: "ignore" });
    return Object.freeze({ destination: target, filesWritten: fileCount, packageName: packageInfo.name, packageVersion: packageInfo.version });
  } catch {
    try { rmSync(target, { recursive: true, force: true }); } catch { /* preserve the original extraction failure */ }
    throw new Error("Packed project template could not be installed");
  }
}

module.exports = Object.freeze({ getPackageInfo: () => packageInfo, materializeProject });
