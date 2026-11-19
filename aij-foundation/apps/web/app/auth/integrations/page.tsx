"use client";

import { AdminShell } from "../../components/admin-shell";
import { AdminIntegrationOperations } from "../../components/admin-integration-operations";

export default function IntegrationOperationsPage() {
  return <AdminShell permission="admin.integration.manage"><AdminIntegrationOperations /></AdminShell>;
}
