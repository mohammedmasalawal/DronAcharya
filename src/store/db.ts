import Dexie, { type Table } from 'dexie';
import type { SkillProfile } from '../engine/adaptive';
import type { ExamRecord, SessionRecord, TraineeRecord, UnitRecord } from './records';

export const DB_NAME = 'dronacharya-store';

export class StoreDb extends Dexie {
  trainees!: Table<TraineeRecord, string>;
  units!: Table<UnitRecord, string>;
  exams!: Table<ExamRecord, string>;
  sessions!: Table<SessionRecord, string>;
  skillProfiles!: Table<SkillProfile, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      trainees: 'id, unitId',
      units: 'id',
      exams: 'id, unitId',
      sessions: 'id, traineeId, unitId, scenarioId, createdAt',
      skillProfiles: 'traineeId',
    });
  }
}

export const db = new StoreDb();
