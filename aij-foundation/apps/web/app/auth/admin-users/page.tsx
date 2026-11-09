import { AdminShell } from "../../components/admin-shell";
import { AdminUsers } from "../../components/admin-users";
export default function AdminUsersPage() { return <AdminShell permission="admin.user.manage"><AdminUsers /></AdminShell>; }
