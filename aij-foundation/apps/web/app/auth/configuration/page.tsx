"use client";

import { AdminConfiguration } from "../../components/admin-configuration";
import { AdminShell } from "../../components/admin-shell";

export default function ConfigurationPage() {
  return <AdminShell permission="admin.config.manage"><AdminConfiguration /></AdminShell>;
}
