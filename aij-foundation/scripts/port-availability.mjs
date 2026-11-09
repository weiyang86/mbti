import { createServer } from "node:net";

export function portProbeError(port, cause) {
  const message = cause.code === "EADDRINUSE"
    ? `AIJ port ${port} is occupied; existing processes were left untouched`
    : `Unable to probe AIJ port ${port}: ${cause.code || "unknown error"} (${cause.syscall || "unknown syscall"})`;
  return new Error(message, { cause });
}

export async function assertPortAvailable(port) {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once("error", (error) => reject(portProbeError(port, error)));
    probe.listen(port, "127.0.0.1", () => probe.close(accept));
  });
}
