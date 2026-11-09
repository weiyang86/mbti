import { AdminShell } from "../../../components/admin-shell";
import { AdminAiTraces } from "../../../components/admin-ai-traces";

export default function AdminAiTracesPage() {
  return <AdminShell permission="admin.runtime.read"><AdminAiTraces /></AdminShell>;
}
