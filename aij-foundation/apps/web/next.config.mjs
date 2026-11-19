import environment from "../../scripts/runtime-environment.cjs";

const runtime = environment.loadRuntimeEnvironment();
const sourceRoot = environment.repositoryRoot;
const isolatedDistDir = process.env.AIJ_NEXT_DIST_DIR;
if (isolatedDistDir !== undefined && !/^\.next-[a-z0-9-]{1,32}$/.test(isolatedDistDir)) throw new Error("AIJ_NEXT_DIST_DIR must be a local isolated .next-* directory");
export function resolveApiConsumerUrl(runtimeConfig, testApiUrl) {
  if (testApiUrl !== undefined && (runtimeConfig.environment !== "test" || testApiUrl !== "/api")) {
    throw new Error("AIJ_TEST_API_URL is available only for same-origin test consumers");
  }
  return testApiUrl ?? runtimeConfig.apiUrl;
}
const apiConsumerUrl = resolveApiConsumerUrl(runtime, process.env.AIJ_TEST_API_URL);

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isolatedDistDir ? { distDir: isolatedDistDir } : {}),
  outputFileTracingRoot: sourceRoot,
  turbopack: { root: sourceRoot },
  env: { NEXT_PUBLIC_API_URL: apiConsumerUrl, AIJ_API_SERVICE: runtime.serviceId }
};

export default nextConfig;
