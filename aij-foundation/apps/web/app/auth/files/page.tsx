"use client";

import { AdminFiles } from "../../components/admin-files";
import { AdminShell } from "../../components/admin-shell";

export default function FilesPage() {
  return <AdminShell permission="admin.file.read"><AdminFiles /></AdminShell>;
}
