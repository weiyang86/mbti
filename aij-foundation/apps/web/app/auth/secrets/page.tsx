"use client";

import { AdminShell } from "../../components/admin-shell";
import { AdminSecretReferences } from "../../components/admin-secrets";

export default function SecretReferencesPage() {
  return <AdminShell permission="admin.secret.manage"><AdminSecretReferences /></AdminShell>;
}
