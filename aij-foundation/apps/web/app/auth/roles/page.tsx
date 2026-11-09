"use client";
import { AdminRoles } from "../../components/admin-roles";
import { AdminShell } from "../../components/admin-shell";

export default function RolesPage() {
  return <AdminShell permission="admin.role.manage"><AdminRoles /></AdminShell>;
}
