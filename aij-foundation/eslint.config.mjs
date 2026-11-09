import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

const webFiles = ["apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"];
const scriptDeclarationFile = "apps/web/app/components/client-personal-script-state.d.mts";
const scriptDeclarationParser = nextVitals.find(config => config.name === "next/typescript");
if (!scriptDeclarationParser) throw new Error("Matching Next TypeScript parser configuration is required");
// Next supplies its matching TypeScript parser/plugin pair for all Web TS extensions.
// Keep the repository's recommended rules; avoid registering two plugin objects.
const scopedTypeScript = tseslint.configs.recommended.map((config) => config.name === "typescript-eslint/base" ? {
  ...config,
  ignores: ["apps/web/**/*.ts", "apps/web/**/*.tsx", "apps/web/**/*.mts", "apps/web/**/*.cts", scriptDeclarationFile]
} : config);
const scopedNextVitals = nextVitals.map((config) => config.ignores ? config : {
  ...config,
  files: config.name === "next/typescript"
    ? ["apps/web/**/*.ts", "apps/web/**/*.tsx", "apps/web/**/*.mts", "apps/web/**/*.cts"]
    : config.files ? config.files.map((pattern) => `apps/web/${pattern}`) : webFiles
});

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "apps/web/.next-*/**", "**/.next-af035/**", "**/.next-af036/**", "**/.next-af037/**", "**/.next-af038/**", "**/.next-af043/**", "**/.next-af048/**", "**/.next-af057/**", "**/.next-af058/**", "**/.next-af061/**", "**/.next-af062/**", "**/dist/**", "apps/api/.base-dev-dist/**", "apps/api/.ai-local-dist/**", "**/coverage/**", "**/._*", "**/next-env.d.ts", ".local-data/**", ".artifacts/**"] },
  eslint.configs.recommended,
  ...scopedTypeScript,
  ...scopedNextVitals,
  { ...scriptDeclarationParser, files: [scriptDeclarationFile] },
  { files: ["apps/api/**/*.ts", "scripts/**/*.{mjs,cjs,cts}"], languageOptions: { globals: globals.node } },
  { files: ["scripts/**/*.cjs"], languageOptions: { sourceType: "commonjs" }, rules: { "@typescript-eslint/no-require-imports": "off" } },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] }
  },
  { files: webFiles, languageOptions: { globals: { ...globals.browser, ...globals.node } }, settings: { next: { rootDir: "apps/web" } } }
);
