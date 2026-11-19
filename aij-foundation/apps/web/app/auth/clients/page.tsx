"use client";

import { AdminShell } from "../../components/admin-shell";
import { AdminClientDirectory } from "../../components/admin-client-directory";

export default function AdminClientsPage() {
  return <AdminShell permission="admin.client.read"><AdminClientDirectory /></AdminShell>;
}
