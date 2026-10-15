import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildDemoData } from '../demoData';

const OUTPUT = 'data/demo/demo-data.json';

const data = buildDemoData();
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(data), 'utf8');

const sizeMb = statSync(OUTPUT).size / (1024 * 1024);
console.log(
  `${OUTPUT}: ${sizeMb.toFixed(2)} MB, ${data.units.length} units, ${data.trainees.length} trainees, ` +
    `${data.exams.length} exams, ${data.sessions.length} sessions, ${data.skillProfiles.length} profiles`,
);
