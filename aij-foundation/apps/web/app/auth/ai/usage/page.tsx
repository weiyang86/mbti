import { AdminShell } from "../../../components/admin-shell";
import { AdminAiUsage } from "../../../components/admin-ai-usage";
export default function AiUsagePage(){return <AdminShell permission="admin.runtime.read"><AdminAiUsage/></AdminShell>;}
