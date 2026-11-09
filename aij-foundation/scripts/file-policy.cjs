"use strict";
const FILE_READ_PERMISSION = "admin.file.read";
const FILE_READ_DEFINITION = Object.freeze({
  code: FILE_READ_PERMISSION,
  name: "AIJ 文件查看",
  action: "read-files",
  path: "/api/admin/files"
});
module.exports = { FILE_READ_PERMISSION, FILE_READ_DEFINITION };
