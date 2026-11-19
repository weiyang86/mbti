"use client";

import { AdminDictionaries } from "../../components/admin-dictionaries";
import { AdminShell } from "../../components/admin-shell";

export default function DictionariesPage() {
  return <AdminShell permission="admin.dict.read"><AdminDictionaries /></AdminShell>;
}
