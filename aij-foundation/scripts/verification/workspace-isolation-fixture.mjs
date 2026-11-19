export const workspaceIsolationTask = "AF-056";

export function workspaceIsolationEnvironment(id) {
  return import("./client-auth-fixture.mjs").then(({ clientEnvironment }) => clientEnvironment(id, workspaceIsolationTask));
}

export function prepareWorkspaceIsolationMembers(id) {
  return import("./client-auth-fixture.mjs").then(({ prepareClientFixture }) => prepareClientFixture(id, workspaceIsolationTask));
}
