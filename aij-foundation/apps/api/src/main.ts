import { Logger } from "@nestjs/common";
import { loadRuntimeEnvironment } from "../../../scripts/runtime-environment.cjs";
import { createApplication } from "./bootstrap";

async function bootstrap() {
  const runtime = loadRuntimeEnvironment();
  const app = await createApplication();
  await app.listen(runtime.apiPort, "127.0.0.1");
  Logger.log(`AIJ Foundation API listening on ${runtime.apiUrl}; /health is liveness, /ready checks the database`, "Bootstrap");
}

void bootstrap().catch(() => {
  Logger.error("AIJ API startup failed; check local configuration", "Bootstrap");
  process.exitCode = 1;
});
