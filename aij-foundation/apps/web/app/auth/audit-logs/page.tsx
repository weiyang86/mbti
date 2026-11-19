"use client";

import { AdminAuditLogs } from "../../components/admin-audit-logs";
import { AdminShell } from "../../components/admin-shell";

export default function AuditLogsPage() {
  return <AdminShell permission="admin.log.read"><AdminAuditLogs /></AdminShell>;
}
