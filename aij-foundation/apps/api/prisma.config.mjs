import { defineConfig } from "prisma/config";

// No dotenv, migration, seed or connection hook. Paths are relative to this file.
export default defineConfig({ schema: "prisma/schema.prisma" });
