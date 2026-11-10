"use client";
import { AdminShell } from "../../../components/admin-shell";
import { AdminMbtiConfig } from "../../../components/admin-mbti-config";
export default function Page() { return <AdminShell permission="admin.plugin.manage"><AdminMbtiConfig /></AdminShell>; }
