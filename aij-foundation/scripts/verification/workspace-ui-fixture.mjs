export const workspaceUiTask = "AF-057";

export function workspaceUiEnvironment(id) {
  return import("./client-auth-fixture.mjs").then(({ clientEnvironment }) => clientEnvironment(id, workspaceUiTask));
}

export function prepareWorkspaceUiMembers(id) {
  return import("./client-auth-fixture.mjs").then(({ prepareClientFixture }) => prepareClientFixture(id, workspaceUiTask));
}
