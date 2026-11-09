export const workspaceBrowserTask = "AF-058";

export function workspaceBrowserEnvironment(id) {
  return import("./client-auth-fixture.mjs").then(({ clientEnvironment }) => clientEnvironment(id, workspaceBrowserTask));
}

export function prepareWorkspaceBrowserMembers(id) {
  return import("./client-auth-fixture.mjs").then(({ prepareClientFixture }) => prepareClientFixture(id, workspaceBrowserTask));
}
