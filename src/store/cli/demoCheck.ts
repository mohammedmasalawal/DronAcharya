import { readFileSync, statSync } from 'node:fs';
import { DemoDataSchema } from '../demoData';

const INPUT = 'data/demo/demo-data.json';
const MAX_BYTES = 6.5 * 1024 * 1024;

const data = DemoDataSchema.parse(JSON.parse(readFileSync(INPUT, 'utf8')));
const size = statSync(INPUT).size;
const problems: string[] = [];

const unitIds = new Set(data.units.map((unit) => unit.id));
const traineeIds = new Set(data.trainees.map((trainee) => trainee.id));
const profileIds = new Set(data.skillProfiles.map((profile) => profile.traineeId));

for (const trainee of data.trainees) {
  if (!unitIds.has(trainee.unitId)) problems.push(`trainee ${trainee.id} has unknown unit`);
  if (!profileIds.has(trainee.id)) problems.push(`trainee ${trainee.id} has no profile`);
}

for (const exam of data.exams) {
  if (!unitIds.has(exam.unitId)) problems.push(`exam ${exam.id} has unknown unit`);
}

const seen = new Set<string>();
for (const session of data.sessions) {
  if (seen.has(session.id)) problems.push(`duplicate session id ${session.id}`);
  seen.add(session.id);
  if (!traineeIds.has(session.traineeId))
    problems.push(`session ${session.id} has unknown trainee`);
  if (session.report.sessionId !== session.id)
    problems.push(`session ${session.id} report id differs`);
  if (session.log.scenarioId !== session.scenarioId)
    problems.push(`session ${session.id} log differs`);
}

for (const trainee of data.trainees) {
  const count = data.sessions.filter((session) => session.traineeId === trainee.id).length;
  if (count !== 12) problems.push(`trainee ${trainee.id} has ${count} sessions`);
}

if (size > MAX_BYTES) problems.push(`file is ${(size / 1048576).toFixed(2)} MB`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(
  `${INPUT} is valid: ${(size / 1048576).toFixed(2)} MB, ${data.sessions.length} sessions, ` +
    `${data.trainees.length} trainees, ${data.units.length} units`,
);
