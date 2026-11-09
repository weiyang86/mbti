"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clientApi } from "./client-api.mjs";

/** Discover the document capability without requiring configured models or exposing private bodies. */
export function ClientDocumentLink({ workspaceId, memberId, permissions }: { workspaceId: string; memberId: string; permissions: readonly string[] }) {
  const [verified, setVerified] = useState<{ workspaceId: string; memberId: string; permissions: readonly string[] } | null>(null);
  useEffect(() => {
    let active = true;
    if (workspaceId && memberId && permissions.includes("workspace.documents.read")) {
      void clientApi("/client/documents?limit=1", { workspaceId }).then(() => { if (active) setVerified({ workspaceId, memberId, permissions }); }, () => { if (active) setVerified(null); });
    }
    return () => { active = false; };
  }, [workspaceId, memberId, permissions]);
  return verified?.workspaceId === workspaceId && verified.memberId === memberId && verified.permissions === permissions && permissions.includes("workspace.documents.read") ?
    <Link href={`/client/documents?workspaceId=${encodeURIComponent(workspaceId)}`}>我的文档</Link> : null;
}
