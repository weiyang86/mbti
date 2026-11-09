import { reporterPath } from "./catalog.mjs";

// Exact protected-file request for the coordinator. This module does not mutate
// package.json or the AF registry and is not used by the product catalog/runner.
const artifactOnly = { writes: [".artifacts/"], services: [], testDatabase: false, uniqueWriter: false };
export const af128Registration = {
  title: "建立不依赖历史报告的产品验证入口",
  prerequisites: [{
    id: "node-and-local-dependencies",
    command: [process.execPath, "--input-type=module", "--eval", "import a from 'node:assert/strict';import {lstatSync} from 'node:fs';import {createRequire} from 'node:module';a.equal(process.versions.node.split('.')[0],'24');a.equal(lstatSync('node_modules').isSymbolicLink(),false);const r=createRequire(process.cwd()+'/package.json');a.equal(r('eslint/package.json').version,'9.39.2');"],
    files: ["package.json", "pnpm-lock.yaml", "docs/development/PRODUCT_VERIFICATION.md"],
    verification: ["Node24、自有依赖已安装；产品入口只读取当前源码，不把历史AF报告作为前置"], effects: artifactOnly
  }],
  steps: [{
    id: "product-runner-regression", kind: "node-test",
    command: [process.execPath, "--test", "--test-reporter=" + reporterPath, "scripts/verification/product/runner.test.mjs", "scripts/verification/product/row-snapshot.test.mjs"],
    testFiles: ["scripts/verification/product/runner.test.mjs", "scripts/verification/product/row-snapshot.test.mjs"],
    files: ["scripts/verification/product/runner.mjs", "scripts/verification/product/catalog.mjs", "scripts/verification/product/database-preflight.mjs", "scripts/verification/product/row-snapshot.mjs", "scripts/verification/product/readiness.test.mjs"],
    verification: ["真实离线子进程：无历史artifacts与AppleDouble元数据保留；SHA/变更/零用例/skip/todo/非零/超时/前置失败/串行锁/工作区拒绝；真实迁移清单缺失拒绝；全表参考数据/ledger指纹增删改拒绝；无数据库连接"], effects: artifactOnly
  }, {
    id: "current-product-checks", kind: "check",
    command: [process.execPath, "scripts/verification/product/runner.mjs", "--group", "checks"],
    files: ["scripts/verification/product/runner.mjs", "scripts/verification/product/catalog.mjs"],
    verification: ["当前源码纯检查组实际执行且报告绑定HEAD/digest；DB/HTTP组与CI-02完整矩阵不计通过"], effects: artifactOnly
  }, {
    id: "product-entry-lint", kind: "check",
    command: ["pnpm", "exec", "eslint", "scripts/verification/product", "--max-warnings=0"],
    files: ["scripts/verification/product/af128-registration.mjs"], verification: ["新增产品验证脚本通过eslint"], effects: artifactOnly
  }, {
    id: "diff-check", kind: "check", command: ["git", "--no-optional-locks", "diff", "--check"],
    files: [], verification: ["差异空白与冲突标记检查"], effects: artifactOnly
  }]
};
