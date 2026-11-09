export const workspaceContextTask = "AF-054";

export function workspaceContextEnvironment(id) {
  return import("./client-auth-fixture.mjs").then(({ clientEnvironment }) => clientEnvironment(id, workspaceContextTask));
}

export function prepareWorkspaceContextMembers(id) {
  return import("./client-auth-fixture.mjs").then(({ prepareClientFixture }) => prepareClientFixture(id, workspaceContextTask));
}
