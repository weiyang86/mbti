import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertPortAvailable } from "../port-availability.mjs";
import { paths, profile, root, refuse, systemEnvironment, validateOwner, assertDockerEndpoint, assertPath, validateValues } from "./config.mjs";

function run(args, env = {}) {
  try { return execFileSync("docker", args, { cwd: root, env: { ...systemEnvironment(), ...env }, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { refuse("Docker operation failed; resources retained (check local Docker and owned AI local configuration)"); }
}
export function localDocker(owner) {
  if (owner) validateOwner(owner);
  const context = run(["context", "show"]);
  if (!/^[a-zA-Z0-9_.-]+$/.test(context)) refuse("Invalid local Docker context");
  const endpoint = JSON.parse(run(["context", "inspect", context, "--format", "{{json .Endpoints.docker}}"]));
  if (!endpoint.Host?.startsWith("unix://") || endpoint.SkipTLSVerify ||
      owner && (owner.dockerContext !== context || owner.dockerEndpoint !== endpoint.Host)) refuse("AI local requires its recorded local Unix-socket Docker context");
  assertDockerEndpoint(endpoint.Host);
  const docker = (args, env) => run(["--context", context, ...args], env);
  if (docker(["version", "--format", "{{.Server.Os}}"]) !== "linux") refuse("AI local requires a local Linux Docker engine");
  return { context, endpoint: endpoint.Host, docker };
}
const lines = text => text.split("\n").filter(Boolean);
function names(handle, type) { return lines(handle.docker(type === "container" ? ["ps", "-a", "--format", "{{.Names}}"] : ["volume", "ls", "--format", "{{.Name}}"])); }
function projectContainers(handle) { return lines(handle.docker(["ps", "-a", "--filter", "label=com.docker.compose.project=" + profile.project, "--format", "{{.Names}}"])); }
export function assertNoResources(handle) {
  if (names(handle, "container").includes(profile.container) || names(handle, "volume").includes(profile.volume) || projectContainers(handle).length ||
      lines(handle.docker(["volume", "ls", "--filter", "label=com.docker.compose.project=" + profile.project, "--format", "{{.Name}}"])).length) refuse("AI local Docker names already exist without a local owner; refusing adoption");
}
export function assertLabels(labels, owner) {
  validateOwner(owner);
  if (labels?.["io.aij.owner"] !== "aij-foundation" || labels["io.aij.project"] !== profile.project ||
      labels["io.aij.environment"] !== profile.environment || labels["io.aij.instance"] !== owner.instanceId ||
      labels["io.aij.repository"] !== root || labels["io.aij.uid"] !== String(owner.uid) || labels["io.aij.machine"] !== owner.machine ||
      labels["com.docker.compose.project"] !== profile.project) refuse("AI local Docker labels do not match the local owner; left untouched");
}
export function assertContainer(container, owner) {
  assertLabels(container.Config?.Labels, owner);
  const labels = container.Config.Labels;
  const ports = container.HostConfig?.PortBindings;
  const bindings = ports?.["5432/tcp"];
  const mounts = container.Mounts;
  // Compose may serialize a named volume through HostConfig.Binds. Permit
  // only that exact owned volume spelling; Mounts must still prove Type=volume.
  const rawMounts = container.HostConfig?.Binds;
  const ownedNamedMount = !rawMounts?.length || Array.isArray(rawMounts) && rawMounts.length === 1 && rawMounts[0] === profile.volume + ":/var/lib/postgresql/data:rw";
  if (container.Name !== "/" + profile.container || container.Config.Image !== profile.image ||
      JSON.stringify(container.Config.Entrypoint) !== JSON.stringify(["docker-entrypoint.sh"]) ||
      JSON.stringify(container.Config.Cmd) !== JSON.stringify(["postgres"]) ||
      labels["com.docker.compose.service"] !== "postgres" || labels["com.docker.compose.project.working_dir"] !== root ||
      labels["com.docker.compose.project.config_files"] !== profile.composeFile ||
      container.HostConfig?.NetworkMode !== "bridge" || container.HostConfig.Privileged ||
      !ownedNamedMount || container.HostConfig.Devices?.length || container.HostConfig.CapAdd?.length ||
      container.HostConfig.PidMode || Object.keys(ports || {}).length !== 1 ||
      bindings?.length !== 1 || bindings[0].HostIp !== "127.0.0.1" || bindings[0].HostPort !== "55435" ||
      mounts?.length !== 1 || mounts[0].Type !== "volume" || mounts[0].Name !== profile.volume || mounts[0].Destination !== "/var/lib/postgresql/data" || mounts[0].RW === false) refuse("AI local container identity/image/loopback/mount configuration differs; left untouched");
  return container;
}
export function inspectResources(handle, owner) {
  validateOwner(owner);
  const containers = projectContainers(handle);
  const volumes = lines(handle.docker(["volume", "ls", "--filter", "label=com.docker.compose.project=" + profile.project, "--format", "{{.Name}}"]));
  if (volumes.some(name => name !== profile.volume)) refuse("Unexpected volume in AI local project; left untouched");
  if (containers.some(name => name !== profile.container)) refuse("Unexpected container in AI local project; left untouched");
  let container = null;
  if (names(handle, "container").includes(profile.container)) {
    // Deliberately do not retrieve Config.Env (contains the PostgreSQL password).
    const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}},"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}}},"HostConfig":{"PortBindings":{{json .HostConfig.PortBindings}},"NetworkMode":{{json .HostConfig.NetworkMode}},"Privileged":{{json .HostConfig.Privileged}},"Binds":{{json .HostConfig.Binds}},"Devices":{{json .HostConfig.Devices}},"CapAdd":{{json .HostConfig.CapAdd}},"PidMode":{{json .HostConfig.PidMode}}},"Mounts":{{json .Mounts}},"State":{"Running":{{json .State.Running}}}}';
    container = assertContainer(JSON.parse(handle.docker(["inspect", "--type", "container", "--format", format, profile.container])), owner);
  }
  const hasVolume = names(handle, "volume").includes(profile.volume);
  if (hasVolume) {
    const [volume] = JSON.parse(handle.docker(["volume", "inspect", profile.volume]));
    assertLabels(volume.Labels, owner);
    if (volume.Name !== profile.volume || volume.Driver !== "local" || Object.keys(volume.Options || {}).length) refuse("AI local volume must use the owned local driver without external options");
  } else if (container || owner.initialized) refuse("AI local persistent volume is missing; refusing an empty replacement");
  return container;
}
function compose(handle, state, args) {
  assertPath(profile.composeFile);
  // Explicit empty env-file prevents Compose from loading the root's unrelated .env.
  return handle.docker(["compose", "--env-file", "/dev/null", "--project-name", profile.project, "--project-directory", root, "-f", profile.composeFile, ...args], {
    AIJ_AI_LOCAL_INSTANCE_ID: state.owner.instanceId, AIJ_AI_LOCAL_DB_PASSWORD: readFileSync(paths.password, "utf8"),
    AIJ_AI_LOCAL_REPOSITORY: root, AIJ_AI_LOCAL_UID: String(state.owner.uid), AIJ_AI_LOCAL_MACHINE: state.owner.machine
  });
}
export function validateCompose(config, owner, password) {
  const service = config.services?.postgres;
  const volume = config.volumes?.postgres_data;
  const allowedService = ["container_name", "image", "network_mode", "restart", "environment", "ports", "volumes", "labels", "healthcheck", "stop_grace_period", "command", "entrypoint"];
  if (Object.keys(config).some(key => !["name", "services", "volumes", "networks"].includes(key)) ||
      Object.keys(service || {}).some(key => !allowedService.includes(key)) ||
      service?.command != null || service?.entrypoint != null ||
      Object.keys(volume || {}).some(key => !["name", "labels", "driver", "external"].includes(key)) ||
      volume?.driver && volume.driver !== "local") refuse("Unapproved AI local Compose extensions; left untouched");
  if (config.name !== profile.project || Object.keys(config.services || {}).length !== 1 ||
      service?.container_name !== profile.container || service.image !== profile.image || service.network_mode !== "bridge" ||
      Object.keys(config.networks || {}).length || service.ports?.length !== 1 || service.ports[0].host_ip !== "127.0.0.1" ||
      String(service.ports[0].published) !== "55435" || service.ports[0].target !== 5432 ||
      service.volumes?.length !== 1 || service.volumes[0].type !== "volume" || service.volumes[0].source !== "postgres_data" || service.volumes[0].target !== "/var/lib/postgresql/data" || service.volumes[0].read_only || service.volumes[0].bind ||
      Object.keys(service.volumes[0].volume || {}).some(key => key !== "nocopy") || service.volumes[0].volume?.nocopy ||
      service.ports[0].protocol && service.ports[0].protocol !== "tcp" ||
      service.environment?.POSTGRES_DB !== profile.database || service.environment.POSTGRES_USER !== profile.user || service.environment.POSTGRES_PASSWORD !== password ||
      service.environment.POSTGRES_HOST_AUTH_METHOD !== "scram-sha-256" ||
      service.environment.POSTGRES_INITDB_ARGS !== "--auth-host=scram-sha-256 --auth-local=scram-sha-256" ||
      Object.keys(service.environment).length !== 5 || service.restart !== "unless-stopped" ||
      JSON.stringify(service.healthcheck?.test) !== JSON.stringify(["CMD", "pg_isready", "-h", "127.0.0.1", "-U", profile.user, "-d", profile.database]) ||
      volume?.name !== profile.volume || volume.external || Object.keys(config.volumes || {}).length !== 1) refuse("AI local Compose configuration does not match the fixed isolated profile");
  // Compose adds its own project label on resources, not necessarily in config output.
  for (const labels of [service.labels, volume.labels]) assertLabels({ ...labels, "com.docker.compose.project": profile.project }, owner);
  return true;
}
export async function startDatabase(handle, state) {
  validateValues(state.values);
  const before = inspectResources(handle, state.owner);
  if (!before?.State.Running) await assertPortAvailable(profile.dbPort);
  validateCompose(JSON.parse(compose(handle, state, ["config", "--format", "json"])), state.owner, readFileSync(paths.password, "utf8"));
  compose(handle, state, ["up", "--detach", "--wait", "--wait-timeout", "40", "--no-recreate", "--pull", "never"]);
  const container = inspectResources(handle, state.owner);
  if (!container?.State.Running) refuse("Owned AI local database did not become running");
  return container;
}
export function stopDatabase(handle, owner) {
  const container = inspectResources(handle, owner);
  if (container?.State.Running) {
    const again = inspectResources(handle, owner);
    if (again?.Id !== container.Id) refuse("AI local container identity changed before stop");
    handle.docker(["stop", "--time", "20", container.Id]);
  }
  return { running: false, volumeRetained: profile.volume };
}
