import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiPersonalSkillsService } from './ai-personal-skills.service';
import { ScriptRunAccessPort, type ScriptScope } from './ai-personal-script-runs.service';

@Injectable()
export class RootScriptRunAccess extends ScriptRunAccessPort {
  constructor(private readonly skills: AiPersonalSkillsService) { super(); }
  withCurrent<T>(member: string, workspace: string, permissions: readonly string[], operation: (tx: Prisma.TransactionClient, scope: ScriptScope) => Promise<T>) {
    return this.skills.scriptRunWithCurrent(member, workspace, permissions, operation);
  }
}
