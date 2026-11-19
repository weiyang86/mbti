import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const reporterPath = fileURLToPath(new URL("../reporter.mjs", import.meta.url));
const check = (id, command, files) => ({ id, kind: "check", command, files });
const tests = (id, testFiles, timeoutMs = 120000) => ({
  id, kind: "node-test", testFiles, files: testFiles, timeoutMs,
  command: [process.execPath, "--test", "--test-concurrency=1", "--test-reporter=" + reporterPath, ...testFiles]
});

// Product capabilities, not AF registrations, frozen task SHAs or previous reports.
// Existing test/fixture names retain their provenance; their assertions execute anew.
export const productCatalog = {
  checks: {
    title: "运行配置、项目隔离与包边界（纯检查）", database: false,
    effects: { writes: [".artifacts/"], services: [], database: false },
    prerequisites: [],
    steps: [tests("runtime-isolation", [
      "scripts/test/runtime-environment.test.mjs",
      "scripts/test/project-configuration.test.mjs",
      "scripts/test/database-target.test.mjs"
    ]), tests("package-ownership", ["scripts/verification/package-boundary.test.mjs"])]
  },
  database: {
    title: "迁移、readiness 与租户身份隔离（串行 DB/HTTP）", database: true,
    effects: {
      writes: [".artifacts/", ".local-data/postgres/", ".local-data/seed/", ".local-data/auth/", "node_modules/.prisma/", "packages/*/dist/", "apps/api/dist/"],
      services: ["existing owned PostgreSQL test:127.0.0.1:55433", "owned loopback API:3656/port0"], database: true
    },
    prerequisites: [
      check("test-database-target", [process.execPath, "scripts/verification/product/database-preflight.mjs"], [
        "scripts/verification/product/database-preflight.mjs", "apps/api/prisma/schema.prisma", "scripts/database/managed.mjs"
      ]),
      check("prisma-generate", [process.execPath, "scripts/prisma-schema.mjs", "generate"], ["scripts/prisma-schema.mjs"]),
      ...["core", "contracts", "runtime-contracts"].map(name => check("build-" + name,
        [process.execPath, "scripts/build-workspace-package.mjs", "packages/" + name], ["packages/" + name + "/src/index.ts"])),
      check("api-compile", ["pnpm", "exec", "tsc", "-p", "apps/api/tsconfig.json"], ["apps/api/tsconfig.json", "apps/api/src/bootstrap.ts"])
    ],
    steps: [
      tests("database-readiness", ["scripts/verification/product/readiness.test.mjs"], 180000),
      tests("workspace-identity-isolation", ["scripts/verification/workspace-isolation.test.mjs"], 360000)
    ]
  }
};

export const deferredMatrix = [
  "GEN-03 后干净 clone 的 ai-standard 生成、安装与端到端产品矩阵（CI-02）",
  "完整管理端/客户端页面、全部插件/异步运行时/集成/AI/通知/支付能力矩阵",
  "真实收费 Provider、部署、发布及负责人接收"
];
