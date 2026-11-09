import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AiCenterCatalog } from '@aij/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { AiAgentSnapshot } from './ai-center-provider';
import { createPersonalAgentDto } from './ai-personal-agents.dto';
import type { PersonalAgentMemoryRef } from './ai-personal-agent-memory-context.service';
import type { DocumentGenerationRef } from './ai-personal-document-run-origin.service';
import type { WorkflowRef } from './ai-personal-workflow-run-origin.service';

export const PERSONAL_AGENT_NAMESPACE = /^personal:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type PersonalAgentProvenance = {
  type: 'personal'; agentId: string; versionId: string; revision: number;
  publicationVersion: number;
  skills: { skillId: string; versionId: string; revision: number }[];
  memoryRefs?: readonly PersonalAgentMemoryRef[];
  workflowOrigin?: WorkflowRef;
  documentOrigin?: DocumentGenerationRef;
};
type Content = { code: string; name: string; instructions: string; enabled: boolean; model_code: string;
  model_revision: number; catalog_version: number; input_fields: string[]; output_format: 'text' | 'json'; output_fields: string[]; revision: number };
type Agent = Content & { id: string; published_revision: number | null; publication_version: number };
type Version = Content & { id: string; skill_binding_count: number };
type Skill = { id: string; skill_id: string; revision: number; name: string; instructions: string; position: number; executable: boolean };
const fields = (r: Content) => ({ code: r.code, name: r.name, instructions: r.instructions, enabled: r.enabled,
  modelCode: r.model_code, modelRevision: r.model_revision, catalogVersion: r.catalog_version,
  inputFields: r.input_fields, outputFormat: r.output_format, outputFields: r.output_fields, revision: r.revision });

/** Trusted DB resolver only; never accepts a caller snapshot and never executes a provider. */
@Injectable()
export class AiPersonalAgentSnapshotsService {
  async resolve(tx: Prisma.TransactionClient, current: { version: number; catalog: AiCenterCatalog },
    member: string, workspace: string, id: string, revision: number): Promise<AiAgentSnapshot> {
    const snapshot = await this.validateDependencies(tx, current, member, workspace, id, revision);
    if (!snapshot.agent.published || !snapshot.source || snapshot.source.publicationVersion < 1)
      throw new ConflictException('Personal Agent is not published');
    return snapshot;
  }
  /** INTERNAL common dependency validation for publishing; never a public bypass. */
  async validateDependencies(tx: Prisma.TransactionClient, current: { version: number; catalog: AiCenterCatalog },
    member: string, workspace: string, id: string, revision: number): Promise<AiAgentSnapshot> {
    const agents = await tx.$queryRaw<Agent[]>`SELECT * FROM public.ai_personal_agent
      WHERE id=${id} AND workspace_id=${workspace} AND member_id=${member} AND deleted_at IS NULL FOR SHARE`;
    const a = agents[0];
    if (!a || !a.enabled) throw new NotFoundException('Personal Agent unavailable');
    if (a.revision !== revision) throw new ConflictException('Personal Agent revision conflict');
    if (!Number.isInteger(a.publication_version) || a.publication_version < 0 || a.publication_version > 2147483647 ||
      (a.published_revision !== null && (a.published_revision !== revision || a.publication_version === 0)))
      throw new ConflictException('Personal Agent publication unavailable');
    if (!PERSONAL_AGENT_NAMESPACE.test('personal:' + a.id)) throw new ConflictException('Personal Agent identity unavailable');
    const versions = await tx.$queryRaw<Version[]>`SELECT * FROM public.ai_personal_agent_version
      WHERE agent_id=${id} AND workspace_id=${workspace} AND member_id=${member} AND revision=${revision} FOR SHARE`;
    const v = versions[0];
    if (!v || !isDeepStrictEqual(fields(a), fields(v)) || !Number.isInteger(v.skill_binding_count) || v.skill_binding_count < 0 || v.skill_binding_count > 8)
      throw new ConflictException('Personal Agent version unavailable');
    // Lock mutable authorization rows as well as historical pins. A newer Skill revision is allowed;
    // a deleted Skill never authorizes execution. ORDER BY preserves immutable binding order.
    const skills = await tx.$queryRaw<Skill[]>`SELECT v.id,v.skill_id,v.revision,v.name,v.instructions,b.position,
      EXISTS(SELECT 1 FROM public.ai_personal_script_version x WHERE x.skill_version_id=v.id) AS executable
      FROM public.ai_personal_agent_skill_binding b
      JOIN public.ai_personal_skill_version v ON v.id=b.skill_version_id AND v.workspace_id=b.workspace_id AND v.member_id=b.member_id
      JOIN public.ai_personal_skill s ON s.id=v.skill_id AND s.workspace_id=v.workspace_id AND s.member_id=v.member_id
      WHERE b.agent_version_id=${v.id} AND b.workspace_id=${workspace} AND b.member_id=${member} AND s.deleted_at IS NULL
      ORDER BY b.position ASC FOR SHARE OF b,v,s`;
    if (skills.length !== v.skill_binding_count || skills.some((s, i) => s.position !== i) || new Set(skills.map(s => s.skill_id)).size !== skills.length)
      throw new NotFoundException('Personal Agent Skill unavailable');
    if (skills.some(s => s.executable)) throw new ConflictException("Executable Skill binding unavailable");
    // Reuse the bounded asset validator, including field/prompt limits, on trusted stored content.
    createPersonalAgentDto({ ...Object.fromEntries(Object.entries(fields(v)).filter(([k]) => k !== 'revision')),
      skillBindings: skills.map(s => ({ skillId: s.skill_id, revision: s.revision })) });
    if (skills.some(s => typeof s.instructions !== 'string' || !s.instructions.trim() || s.instructions.length > 8000 || Buffer.byteLength(s.instructions) > 32768 || s.instructions.includes('\0')))
      throw new ConflictException('Personal Agent Skill unavailable');
    const model = current.catalog.models.find(m => m.code === v.model_code && m.revision === v.model_revision && m.enabled && m.capability === 'text');
    const provider = current.catalog.providers.find(p => p.code === model?.providerCode && p.enabled);
    if (current.version !== v.catalog_version || !model || !provider || !['openai', 'deepseek', 'aliyun', 'compatible'].includes(provider.vendor))
      throw new ConflictException('Personal Agent model configuration unavailable');
    const skillSnapshots = skills.map(s => ({ code: 'personal:' + s.skill_id, name: s.name, instructions: s.instructions, enabled: true, revision: s.revision }));
    return { provider, model, agent: { code: 'personal:' + id, name: v.name, instructions: v.instructions, enabled: true, published: a.published_revision === revision,
      modelCode: model.code, skillCodes: skillSnapshots.map(s => s.code), inputFields: v.input_fields,
      outputFormat: v.output_format, outputFields: v.output_fields, revision }, skills: skillSnapshots,
      source: { type: 'personal', agentId: id, versionId: v.id, revision, publicationVersion: a.publication_version,
        skills: skills.map(s => ({ skillId: s.skill_id, versionId: s.id, revision: s.revision })) } };
  }
}
