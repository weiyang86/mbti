import { Injectable } from '@nestjs/common';
import { AiCenterRunService } from './ai-center-run.service';
import { personalAgentId, personalAgentObject, personalAgentRevision } from './ai-personal-agents.dto';

export function personalAgentRunRequest(id: string, raw: unknown) {
  personalAgentId(id);
  const body = personalAgentObject(raw, ['input', 'idempotencyKey', 'expectedRevision'], ['input', 'idempotencyKey', 'expectedRevision']);
  return { input: body.input, idempotencyKey: body.idempotencyKey, expectedRevision: personalAgentRevision(body.expectedRevision) };
}

/** Admission delegates to the existing run/Job/reservation owner. */
@Injectable()
export class AiPersonalAgentRunsService {
  constructor(private readonly runs: AiCenterRunService) {}
  submit(member: string, workspace: string, id: string, raw: unknown, correlationId?: string) {
    return this.runs.submitPersonal(member, workspace, id, personalAgentRunRequest(id, raw), correlationId);
  }
}
