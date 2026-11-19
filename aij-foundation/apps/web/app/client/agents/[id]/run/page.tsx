import { ClientPersonalAgentRun } from "../../../../components/client-personal-agent-run";

export default async function PersonalAgentRunPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  // Only opaque selectors are passed to the client. Invalid selectors fail closed in page state.
  const workspaceId = typeof query.workspaceId === "string" ? query.workspaceId : query.workspaceId === undefined ? "" : "invalid selector";
  return <ClientPersonalAgentRun key={`${id}:${workspaceId}`} agentId={id} workspaceId={workspaceId} />;
}
