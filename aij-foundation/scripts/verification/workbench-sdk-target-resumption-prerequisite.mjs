import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const program = read('docs/planning/auto-ai-program-20261105/program.json');
const wave = program.nextWaves.find(w => w.id === 'W22'), resumed = wave.resumedCards.find(c => c.formalTaskId === 'AF-191');
assert.equal(wave.ownerInstruction, '按照以上规划开始进行开发');
assert.equal(resumed.priorEffectiveHoursConservativeCarry, 1.5);
assert.equal(resumed.additionalHoursLimit, 2.5); assert.equal(resumed.currentTotalHoursCap, 4);
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
for (const id of resumed.codeDeps) assert.equal(tasks.find(t => t.id === id)?.status, 'completed', id);
for (const file of read('docs/planning/auto-ai-program-20261105/W22/AF-191-ROOT_SOURCES.json').files) {
  assert.equal(createHash('sha256').update(readFileSync(file.path)).digest('hex'), file.sha256, file.path);
}
console.log(JSON.stringify({ task: 'AF-191', scope: 'bounded W22 root continuation only', source: 'HASH_CHECKED_NOT_TARGET_PASSED', priorHours: 1.5, additionalCap: 2.5, totalCap: 4 }));
