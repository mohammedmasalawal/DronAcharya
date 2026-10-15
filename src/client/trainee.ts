import { getTrainee, listTrainees, listUnits, saveTrainee, saveUnit } from '../store';

export const GUEST_UNIT_ID = 'guest';
export const GUEST_UNIT_NAME = 'Guest';

const LAST_TRAINEE_KEY = 'dronacharya.lastTrainee';

export interface TraineeChoice {
  traineeId: string;
  name: string;
  unitId: string;
  unitName: string;
}

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'guest-trainee';
}

export function rememberTrainee(choice: TraineeChoice): void {
  try {
    localStorage.setItem(LAST_TRAINEE_KEY, JSON.stringify(choice));
  } catch {
    return;
  }
}

export function recallTrainee(): TraineeChoice | null {
  try {
    const raw = localStorage.getItem(LAST_TRAINEE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { traineeId, name, unitId, unitName } = value as Record<string, unknown>;
    if (
      typeof traineeId === 'string' &&
      typeof name === 'string' &&
      typeof unitId === 'string' &&
      typeof unitName === 'string'
    ) {
      return { traineeId, name, unitId, unitName };
    }
    return null;
  } catch {
    return null;
  }
}

export async function listTraineeChoices(): Promise<TraineeChoice[]> {
  const units = await listUnits();
  const choices: TraineeChoice[] = [];
  for (const unit of units) {
    for (const trainee of await listTrainees(unit.id)) {
      choices.push({
        traineeId: trainee.id,
        name: trainee.name,
        unitId: unit.id,
        unitName: unit.name,
      });
    }
  }
  return choices;
}

export async function createGuestTrainee(name: string): Promise<TraineeChoice> {
  const traineeId = slugify(name);
  const existing = await getTrainee(traineeId);
  if (existing) {
    const unit = (await listUnits()).find((candidate) => candidate.id === existing.unitId);
    return {
      traineeId: existing.id,
      name: existing.name,
      unitId: existing.unitId,
      unitName: unit ? unit.name : existing.unitId,
    };
  }

  await saveUnit({ id: GUEST_UNIT_ID, name: GUEST_UNIT_NAME });
  const display = name.trim().length > 0 ? name.trim() : 'Guest trainee';
  await saveTrainee({ id: traineeId, name: display, unitId: GUEST_UNIT_ID });
  return { traineeId, name: display, unitId: GUEST_UNIT_ID, unitName: GUEST_UNIT_NAME };
}
