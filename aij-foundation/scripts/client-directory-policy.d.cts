export const CLIENT_DIRECTORY_READ_PERMISSION: "admin.client.read";
export const CLIENT_DIRECTORY_READ_DEFINITION: Readonly<{
  code: "admin.client.read";
  name: "客户账号只读查询";
  action: "read-client-directory";
  path: "/api/admin/clients";
}>;
export const CLIENT_SESSION_REVOKE_PERMISSION: "admin.client.sessions.revoke";
export const CLIENT_SESSION_REVOKE_DEFINITION: Readonly<{
  code: "admin.client.sessions.revoke";
  name: "客户会话受控撤销";
  action: "revoke-client-session";
  path: "/api/admin/clients/:memberId/sessions/:sessionId/revoke";
}>;
