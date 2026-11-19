"use strict";
const SECRET_PERMISSION = "admin.secret.manage";
const SECRET_DEFINITION = Object.freeze({ code: SECRET_PERMISSION, name: "AIJ 密钥引用管理", action: "manage-secret-references", path: "/api/admin/secret-references" });
module.exports = { SECRET_PERMISSION, SECRET_DEFINITION };
