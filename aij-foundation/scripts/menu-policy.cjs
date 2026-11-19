"use strict";
const MENU_PERMISSION = "admin.menu.manage";
const MENU_DEFINITION = Object.freeze({ code: MENU_PERMISSION, name: "AIJ 菜单管理", action: "manage-menus", path: "/api/admin/menus" });
module.exports = { MENU_PERMISSION, MENU_DEFINITION };
