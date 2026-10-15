import Dexie, { type Table } from 'dexie';
import {
  ScenarioSpecSchema,
  SessionLogSchema,
  type ScenarioSpec,
  type SessionLog,
} from '../schema';

export interface StoredSession {
  id: string;
  examId: string;
  traineeId: string;
  spec: ScenarioSpec;
  log: SessionLog;
  endedAtSec: number;
  savedAt: number;
}

class ClientDb extends Dexie {
  sessions!: Table<StoredSession, string>;

  constructor() {
    super('dronacharya-client');
    this.version(1).stores({ sessions: 'id, examId, traineeId, savedAt' });
  }
}

const db = new ClientDb();

export async function saveSession(
  input: Omit<StoredSession, 'id' | 'savedAt'>,
): Promise<StoredSession> {
  const stored: StoredSession = {
    ...input,
    spec: ScenarioSpecSchema.parse(input.spec),
    log: SessionLogSchema.parse(input.log),
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };
  await db.sessions.put(stored);
  return stored;
}

export async function loadSession(id: string): Promise<StoredSession | undefined> {
  return db.sessions.get(id);
}

export async function listSessions(): Promise<StoredSession[]> {
  return db.sessions.orderBy('savedAt').reverse().toArray();
}

const TRAINEE_KEY = 'dronacharya.trainee';

export function getTraineeId(): string {
  try {
    return localStorage.getItem(TRAINEE_KEY) || 'trainee';
  } catch {
    return 'trainee';
  }
}

export function setTraineeId(id: string): void {
  try {
    localStorage.setItem(TRAINEE_KEY, id);
  } catch {
    return;
  }
}
