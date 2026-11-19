"use strict";

// Dedicated read privilege for the project-scoped client identity projection.
const CLIENT_DIRECTORY_READ_PERMISSION = "admin.client.read";
const CLIENT_SESSION_REVOKE_PERMISSION = "admin.client.sessions.revoke";
const CLIENT_DIRECTORY_READ_DEFINITION = Object.freeze({
  code: CLIENT_DIRECTORY_READ_PERMISSION,
  name: "客户账号只读查询",
  action: "read-client-directory",
  path: "/api/admin/clients"
});
const CLIENT_SESSION_REVOKE_DEFINITION = Object.freeze({
  code: CLIENT_SESSION_REVOKE_PERMISSION,
  name: "客户会话受控撤销",
  action: "revoke-client-session",
  path: "/api/admin/clients/:memberId/sessions/:sessionId/revoke"
});

module.exports = { CLIENT_DIRECTORY_READ_PERMISSION, CLIENT_DIRECTORY_READ_DEFINITION, CLIENT_SESSION_REVOKE_PERMISSION, CLIENT_SESSION_REVOKE_DEFINITION };
