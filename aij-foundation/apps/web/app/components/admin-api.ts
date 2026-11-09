"use client";

export type AdminUser = { id: string; username: string; realName: string; isSuperAdmin: boolean };
export type AdminSessionData = { user: AdminUser; csrfToken: string };
export class RequestFailure extends Error {
  constructor(readonly status: number) { super("Request failed"); }
}
export async function adminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new RequestFailure(503);
  const response = await fetch(url + path, { ...options, credentials: "include", cache: "no-store", signal: options.signal ?? AbortSignal.timeout(8000) });
  if (!response.ok) throw new RequestFailure(response.status);
  const body = await response.json();
  if (!body.success) throw new RequestFailure(503);
  return body.data as T;
}
export function requestMessage(error: unknown) {
  const status = error instanceof RequestFailure ? error.status : 503;
  return status === 400 ? "请检查输入格式和所选状态，然后重试。" : status === 401 ? "登录已失效，请重新登录。" : status === 403 ? "你没有此操作的权限，请联系管理员。" : status === 404 ? "记录已不存在，请刷新列表。" : status === 409 ? "操作未完成：记录重复、被引用或受系统保护。请刷新后检查。" : "暂时无法连接服务，请稍后重试。";
}
export const adminTheme = { token: { colorPrimary: "#315b3a", colorText: "#242724", colorBorder: "#d5dcd1", borderRadius: 8, controlHeight: 40, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } };
