export const dynamic = "force-dynamic";
import Link from "next/link";

type HealthResponse = {
  success: boolean;
  data: { service: string; status: string; scope: string; time: string; database: string; enabledPlugins: string[] };
};

async function getHealth(): Promise<HealthResponse["data"] | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = await response.json() as HealthResponse;
    if (!body.success || body.data.service !== process.env.AIJ_API_SERVICE || body.data.scope !== "process") return null;
    return body.data;
  } catch { return null; }
}

export default async function Home() {
  const health = await getHealth();
  return (
    <main>
      <p className="eyebrow">F01 · 后端装配与工程骨架</p>
      <h1>AIJ Foundation</h1>
      <p>独立底座工程入口。当前只验证 Web 与 API 进程，后台功能按迁出任务逐项接入。</p>
      <section aria-labelledby="process-status">
        <h2 id="process-status">API 进程状态</h2>
        <p role="status">{health?.status === "ok" ? "已连接 AIJ API" : "API 暂不可用，请启动新库 API 后刷新"}</p>
        <dl>
          <dt>API 地址</dt><dd><a href={`${process.env.NEXT_PUBLIC_API_URL}/health`}>{process.env.NEXT_PUBLIC_API_URL}/health</a></dd>
          <dt>服务标识</dt><dd>{health?.service ?? "尚未获取"}</dd>
          <dt>检查时间</dt><dd>{health?.time ?? "尚未获取"}</dd>
          <dt>插件</dt><dd>{health ? (health.enabledPlugins.length ? health.enabledPlugins.join(", ") : "未装配插件") : "尚未获取"}</dd>
        </dl>
      </section>
      <p><Link href="/login">进入管理员登录</Link></p>
      <p><Link href="/client/login">进入客户 Workspace</Link></p>
      <p className="note">进程健康结果不代表数据库就绪。管理员登录需要本项目认证与数据库配置。</p>
    </main>
  );
}
