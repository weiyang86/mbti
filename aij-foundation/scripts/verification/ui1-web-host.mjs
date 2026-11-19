// Owned production Next host for local acceptance; no frontend implementation copy.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { join } from "node:path";
import { repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
const require = createRequire(join(repositoryRoot, "apps/web/package.json"));
await assertPortAvailable(3655);
const app = require("next")({ dev: false, dir: join(repositoryRoot, "apps/web"), hostname: "localhost", port: 3655 });
await app.prepare();
const handler = app.getRequestHandler(), server = createServer((request, response) => { void handler(request, response); });
server.listen(3655, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { server.close(); server.closeIdleConnections(); await app.close(); });
