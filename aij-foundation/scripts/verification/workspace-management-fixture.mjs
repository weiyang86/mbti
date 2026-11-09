export const workspaceManagementTask = "AF-055";

export function workspaceManagementEnvironment(id) {
  return import("./client-auth-fixture.mjs").then(({ clientEnvironment }) => clientEnvironment(id, workspaceManagementTask));
}

export function prepareWorkspaceManagementMembers(id) {
  return import("./client-auth-fixture.mjs").then(({ prepareClientFixture }) => prepareClientFixture(id, workspaceManagementTask));
}
