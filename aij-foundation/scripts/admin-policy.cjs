"use strict";

// One policy owner shared by the accepted Seed and the administrator API.
const ADMIN_PASSWORD_COST = 12;
const ADMIN_USERS_PERMISSION = "admin.user.manage";
function isAdminPassword(value) {
  const types = typeof value === "string" ? [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(pattern => pattern.test(value)).length : 0;
  return typeof value === "string" && value.length >= 20 && Buffer.byteLength(value, "utf8") <= 72 && !/\s/.test(value) &&
    !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && types >= 3 &&
    !/change.?me|replace|template|example|default|password|dev.admin|admin123|qingqi/i.test(value);
}
module.exports = { ADMIN_PASSWORD_COST, ADMIN_USERS_PERMISSION, isAdminPassword };
