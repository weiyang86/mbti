import { BadRequestException } from '@nestjs/common';
import { updatePersonalSkillDto } from './ai-personal-skills.dto';
import { scriptObject, scriptOpaqueId, scriptSource, scriptText } from './ai-personal-script-skill-contract';

export function createPersonalScriptVersionDto(raw: unknown) {
  try {
    const b = scriptObject(raw, ['skillId', 'expectedRevision', 'name', 'instructions', 'scriptSource']);
    scriptText(b.name); scriptText(b.instructions);
    const content = updatePersonalSkillDto({ name: b.name, instructions: b.instructions, expectedRevision: b.expectedRevision });
    return { ...content, skillId: scriptOpaqueId(b.skillId), scriptSource: scriptSource(b.scriptSource) };
  } catch { throw new BadRequestException('Invalid personal script version request'); }
}
