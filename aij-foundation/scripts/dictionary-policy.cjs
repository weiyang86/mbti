"use strict";
const DICTIONARY_PERMISSION = "admin.dict.manage";
const DICTIONARY_DEFINITION = Object.freeze({ code: DICTIONARY_PERMISSION, name: "AIJ 字典管理", action: "manage-dictionaries", path: "/api/admin/dicts" });
const DICTIONARY_READ_PERMISSION = "admin.dict.read";
const DICTIONARY_READ_DEFINITION = Object.freeze({ code: DICTIONARY_READ_PERMISSION, name: "AIJ 字典查询", action: "read-dictionaries", path: "/api/admin/dicts" });
// Inputs come from the current server-side identity/role joins and active catalog.
// Only this explicit capability has a compatibility implication; no generic *.manage rule.
function dictionaryEffectivePermissions(granted, activeCodes) {
  const active = new Set(activeCodes);
  const effective = new Set(granted.filter(code => active.has(code)));
  if (effective.has(DICTIONARY_PERMISSION) && active.has(DICTIONARY_READ_PERMISSION)) effective.add(DICTIONARY_READ_PERMISSION);
  return [...effective].sort();
}
module.exports = { DICTIONARY_PERMISSION, DICTIONARY_DEFINITION, DICTIONARY_READ_PERMISSION, DICTIONARY_READ_DEFINITION, dictionaryEffectivePermissions };
