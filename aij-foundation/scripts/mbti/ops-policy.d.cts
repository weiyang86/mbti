export const grants: Readonly<Record<string, string>>;
export const roles: Readonly<Record<"owner" | "editor" | "support" | "reader", string[]>>;
export function capabilities(permissions: string[]): Record<string, boolean>;
