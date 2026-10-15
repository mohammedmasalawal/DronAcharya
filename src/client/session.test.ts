import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBot } from '../engine/bots';
import { DEFAULT_TREE } from '../engine/defaultTree';
import { generateScenario } from '../engine/generator';
import { analyseSession } from '../engine/scoring';
import type { Difficulty, SessionEvent } from '../schema';
import { createWorld, finish, getObservations, replayEvents, step, type SimInput } from '../sim';
import {
  createExam,
  db,
  getSession,
  listAllSessions,
  listSessions,
  listTrainees,
  listUnits,
} from '../store';
import { completeSession, debriefPath, replayPath } from './session';
import { createGuestTrainee, slugify } from './trainee';

const uniform = (value: number): Difficulty => ({
  threatCount: value,
  speed: value,
  altitude: value,
  evasiveness: value,
  ambiguity: value,
  degradation: value,
  timePressure: value,
});

async function clearAll(): Promise<void> {
  await Promise.all([
    db.trainees.clear(),
    db.units.clear(),
    db.exams.clear(),
    db.sessions.clear(),
    db.skillProfiles.clear(),
  ]);
}

beforeEach(clearAll);

describe('client save path to replay and score', () => {
  it('stores a completed bot session and reproduces its replay and score', async () => {
    const spec = generateScenario(31, uniform(0.5), []);
    const log = runBot(spec, 'expert');

    const completed = await completeSession({
      spec,
      events: log.events,
      endedAtSec: spec.durationSec,
      traineeId: 'ana',
      unitId: 'guest',
    });

    expect(completed.id).toBe(`${spec.id}:ana:1`);
    expect(completed.debriefPath).toBe(debriefPath(completed.id));
    expect(completed.debriefPath).toBe(`/debrief/${encodeURIComponent(completed.id)}`);
    expect(decodeURIComponent(completed.debriefPath.split('/').pop()!)).toBe(completed.id);

    const record = await getSession(completed.id);
    expect(record).toBeDefined();
    expect(record!.spec).toEqual(spec);
    expect(record!.log.events).toEqual(log.events);
    expect(record!.log.traineeId).toBe('ana');
    expect(record!.endedAtSec).toBe(spec.durationSec);

    expect(replayEvents(record!.spec, record!.log, record!.endedAtSec)).toEqual(record!.log.events);

    const rescored = analyseSession(record!.spec, record!.log, DEFAULT_TREE);
    expect(rescored.report.total).toBe(record!.report.total);
    expect(rescored.report.byStage).toEqual(record!.report.byStage);
    expect(rescored.report.competencies).toEqual(record!.report.competencies);
    expect(rescored.report.decisions).toEqual(record!.report.decisions);
    expect(rescored.extras).toEqual(record!.extras);
    expect(record!.report.total).toBeGreaterThan(70);
  });

  it('saves a session ended early with the time it actually ended', async () => {
    const spec = generateScenario(32, uniform(0.4), []);
    const world = createWorld(spec);
    const inputs = new Map<number, SimInput[]>();
    let scripted = false;

    for (let tick = 0; tick < 700; tick++) {
      const queued: SimInput[] = [];
      if (!scripted) {
        const seen = getObservations(world)[0];
        if (seen) {
          queued.push({ type: 'detect', threatId: seen.threatId });
          inputs.set(world.tick, queued);
          scripted = true;
        }
      }
      step(world, queued);
    }
    finish(world);
    expect(world.t).toBeLessThan(spec.durationSec);

    const completed = await completeSession({
      spec,
      events: world.events,
      endedAtSec: world.t,
      traineeId: 'ben',
      unitId: 'guest',
    });
    const record = (await getSession(completed.id))!;

    expect(record.endedAtSec).toBeCloseTo(35, 5);
    expect(record.log.events.some((event) => event.type === 'detect')).toBe(true);
    expect(replayEvents(record.spec, record.log, record.endedAtSec)).toEqual(record.log.events);
    expect(record.report.total).toBeLessThan(100);
  });

  it('numbers repeat plays of the same scenario and lists them for the trainee', async () => {
    const spec = generateScenario(33, uniform(0.3), []);
    const events = runBot(spec, 'novice').events;
    const base = { spec, events, endedAtSec: spec.durationSec, traineeId: 'cat', unitId: 'guest' };

    const first = await completeSession(base);
    const second = await completeSession(base);
    expect(second.id).toBe(`${spec.id}:cat:2`);
    expect((await listSessions('cat')).map((row) => row.id)).toEqual([first.id, second.id]);
    expect((await listAllSessions()).map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it('marks a session with the exam id only when one is supplied', async () => {
    const spec = generateScenario(34, uniform(0.3), []);
    const events: SessionEvent[] = runBot(spec, 'expert').events;
    const base = { spec, events, endedAtSec: spec.durationSec, traineeId: 'dee', unitId: 'guest' };

    await createExam({ id: 'unit-exam', unitId: 'guest', seed: 34, difficulty: uniform(0.3) });
    const practice = await completeSession(base);
    const exam = await completeSession({ ...base, examId: 'unit-exam' });

    expect((await getSession(practice.id))!.examId).toBeUndefined();
    expect((await getSession(exam.id))!.examId).toBe('unit-exam');
  });

  it('builds replay links that survive colons in session ids', () => {
    const id = 'scn-1587324275:demo-alpha-01:3';
    expect(replayPath(id, 12.34)).toBe(`/replay/${encodeURIComponent(id)}?t=12.3`);
    expect(replayPath(id)).toBe(`/replay/${encodeURIComponent(id)}?t=0.0`);
    expect(replayPath(id, -4)).toContain('?t=0.0');
  });
});

describe('guest trainees', () => {
  it('slugs a typed name into an id', () => {
    expect(slugify('  Maj. R. Sharma ')).toBe('maj-r-sharma');
    expect(slugify('Ürsula 7')).toBe('rsula-7');
    expect(slugify('***')).toBe('guest-trainee');
  });

  it('creates the Guest unit on demand and reuses an existing trainee', async () => {
    expect(await listUnits()).toEqual([]);
    const created = await createGuestTrainee('Asha Rao');
    expect(created).toMatchObject({
      traineeId: 'asha-rao',
      name: 'Asha Rao',
      unitId: 'guest',
      unitName: 'Guest',
    });
    expect((await listUnits()).map((unit) => unit.id)).toEqual(['guest']);
    expect((await listTrainees('guest')).map((trainee) => trainee.name)).toEqual(['Asha Rao']);

    const again = await createGuestTrainee('asha  RAO');
    expect(again.traineeId).toBe('asha-rao');
    expect(again.name).toBe('Asha Rao');
    expect(await listTrainees('guest')).toHaveLength(1);
    expect(await listUnits()).toHaveLength(1);
  });

  it('plays under a guest trainee and the session shows up with their name', async () => {
    const guest = await createGuestTrainee('Test Cadet');
    const spec = generateScenario(35, uniform(0.4), []);
    const completed = await completeSession({
      spec,
      events: runBot(spec, 'expert').events,
      endedAtSec: spec.durationSec,
      traineeId: guest.traineeId,
      unitId: guest.unitId,
    });
    const record = (await getSession(completed.id))!;
    expect(record.traineeId).toBe('test-cadet');
    expect(record.unitId).toBe('guest');
    expect(await listSessions('test-cadet')).toHaveLength(1);
  });
});
