# DronAcharya

Smart India Hackathon PS 26247 (Ministry of Defence, Defence Services Staff College): "AI-Enabled Drone & Counter-Drone Threat Simulation Trainer". 2-person team, 5 days total, keep everything lean.

## Goal

A browser-based simulator that trains personnel to detect, classify and engage drones and swarms. Offline-capable, runs on an ordinary laptop. Four required outcomes:

1. Desktop simulator with scripted and procedurally generated scenarios (day/night, degraded sensors, urban/rural terrain, single drone and swarm).
2. Decision-tree scoring on detection time, classification accuracy and engagement decisions.
3. After-action review dashboard tracking individual and unit performance over repeated sessions.
4. Adjustable difficulty and scenario randomisation to prevent rote learning.

## Stack (fixed)

pnpm, Vite, React 18, TypeScript strict, three, @react-three/fiber, @react-three/drei, zustand, zod, dexie, recharts, vitest. No backend; all data stays in the browser (IndexedDB). Must build as a static site deployable on Vercel.

## Team split

- Person A owns `src/sim` and `src/client`.
- Person B owns `src/engine`, `src/store`, `src/dashboard`, `src/instructor` and `data/`.
- `src/schema` and `src/shared` are shared and frozen at schema v1 (git tag `schema-v1`); any change needs both people to agree.

## Hard rules

- Write no code comments anywhere. Keep code simple and readable.
- `src/sim` and `src/engine` are deterministic: seeded PRNG (mulberry32), fixed 50 ms timestep, no `Date.now` or `Math.random`.
- Small commits with conventional messages. Vitest tests for `src/sim` and `src/engine`.

## Schemas (source of truth: `src/schema/index.ts`)

- **ScenarioSpec**: id, seed, mapType (rural|urban|hilly|industrial), timeOfDay (day|dusk|night), weather (clear|haze|rain|fog), durationSec, sensors[{type: radar|eoir|rf, health 0-1, failAtSec?}], effectors[{type: jammer|spoofer|gun|net|interceptor, rangeM, ammo}], assets[{id, x, y, value}], threats[{id, cls: quad|fpv|fixedwing|loiter|bird|friendly|civilian, hostile, rfEmitting, spawnAtSec, bearingDeg, rangeM, altM, speedMps, behavior: direct|terrain_mask|evasive|loiter|swarm, swarmId?}], roe{requireClassification, minConfidence}, difficulty{threatCount, speed, altitude, evasiveness, ambiguity, degradation, timePressure; all 0-1}, noveltyScore.
- **SessionEvent**: discriminated union on `type`, each with `t` in seconds: observable{threatId} (ground truth, first moment any sensor could see it), detect{threatId}, classify{threatId, cls, confidence, followedAssistant, assistantCorrect}, rank{order[]}, engage{threatId, effector}, result{threatId, outcome: neutralised|leak|fratricide|wasted|ignored}.
- **SessionLog**: scenarioId, traineeId, events[].
- **ScoringTree**: nodes with id, stage, question, branches[{condition, points, label}], weights per stage (detection 20, classification 25, assessment 15, engagement 30, outcome 10), criticalFails[].
- **ScoreReport**: sessionId, total, byStage, decisions[{threatId, stage, points, max, nodePath[], reason}], competencies{detect, classify, prioritise, engage, roe, trust}, critical[].

### Frozen decisions (schema v1)

- `classify.followedAssistant` is true when the trainee's chosen class matched the assistant's suggestion; `assistantCorrect` is whether the assistant's suggestion was right.
- Trust logic: followed and wrong is a penalty, overrode and wrong is a bonus, followed and right is a small bonus, overrode and right is a small penalty.
- `CONDITION_IDS` is exported from `src/schema`. `ScoringTree` rejects any branch or critical-fail condition not in that list. The default tree and all tests use only those ids.
- Branch `points` is a fraction in [-1, 1] of the node's share of the stage weight; negative values are penalties.
- `total` and `competencies` are 0 to 100. The adaptive engine divides competencies by 100.
- `decisions[].max` equals the stage weight divided by the number of threats.
- Detection by reaction time as a fraction of the warning window: `<= 0.25` scores 1, `<= 0.6` scores 0.6, later scores 0.2, never detected scores 0.
- Assessment by rank position: exact 1, within 1 position 0.6, within 2 positions 0.3, otherwise 0. Kendall tau is computed separately for display only.
- Critical fails: `engaged_friendly` caps the total at 40; `held_fire_on_hostile` is flagged in `critical[]` with no cap.
- `criticalFails[]` items are `{id, condition, label, scoreCap?}`; `critical[]` in a report items are `{id, threatId?, label}`.
- `src/shared/prng.ts` (`mulberry32`) is frozen with `src/schema`. Sim and engine both import from it.
- `World`, `SimInput` and `Observation` live in `src/sim` and are Person A's to reshape. The function names `createWorld`, `step` and `getObservations` are frozen.
- `nodeLinker: hoisted` in `pnpm-workspace.yaml` and TypeScript 5.9 stay as they are.

## Stub contract

- `src/sim/index.ts`: `createWorld(spec)`, `step(world, inputs, dt)`, `getObservations(world)`
- `src/engine/generator.ts`: `generateScenario(seed, difficulty, history): ScenarioSpec`
- `src/engine/scoring.ts`: `scoreSession(spec, log, tree): ScoreReport`
- `src/engine/adaptive.ts`: `updateSkill(profile, report)`, `nextDifficulty(profile)`
- `src/engine/bots.ts`: `runBot(spec, kind: expert|novice|overtrusting): SessionLog`
- `src/shared/prng.ts`: `mulberry32(seed)`

## Commands

See README.md.
