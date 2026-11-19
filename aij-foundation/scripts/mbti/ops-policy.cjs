// MBTI operations presentation grants. Business writes remain owned by B2–B5/C2.
const grants = Object.freeze({
  access: "mbti:ops:access",
  orders: "mbti:orders:read",
  draft: "mbti:ops:draft:write",
  systemRead: "mbti:ops:system:read",
  systemWrite: "mbti:ops:system:write",
  release: "mbti:ops:release:write",
  fulfillment: "mbti:ops:fulfillment:write",
  generationRetry: "mbti:ops:generation:retry",
  moderationRead: "mbti:ops:moderation:read",
  moderation: "mbti:ops:moderation:write",
  export: "mbti:ops:export",
  redemption: "mbti:ops:redemption:write"
});
const roles = Object.freeze({
  owner: Object.values(grants),
  editor: [grants.access, grants.orders, grants.systemRead, grants.draft, grants.moderationRead, grants.moderation, grants.export],
  support: [grants.access, grants.orders, grants.systemRead, grants.fulfillment, grants.generationRetry, grants.moderationRead, grants.moderation, grants.export],
  reader: [grants.access, grants.orders, grants.systemRead, grants.moderationRead]
});
function capabilities(permissions) {
  return Object.fromEntries(Object.entries(grants).map(([key, code]) => [key, permissions.includes(code)]));
}
module.exports = { grants, roles, capabilities };
