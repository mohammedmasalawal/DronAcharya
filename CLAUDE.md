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
- `src/schema` is shared and frozen after the scaffold task; any change needs both people to agree.

## Hard rules

- Write no code comments anywhere. Keep code simple and readable.
- `src/sim` and `src/engine` are deterministic: seeded PRNG (mulberry32), fixed 50 ms timestep, no `Date.now` or `Math.random`.
- Small commits with conventional messages. Vitest tests for `src/sim` and `src/engine`.

## Schemas (source of truth: `src/schema/index.ts`)

- **ScenarioSpec**: id, seed, mapType (rural|urban|hilly|industrial), timeOfDay (day|dusk|night), weather (clear|haze|rain|fog), durationSec, sensors[{type: radar|eoir|rf, health 0-1, failAtSec?}], effectors[{type: jammer|spoofer|gun|net|interceptor, rangeM, ammo}], assets[{id, x, y, value}], threats[{id, cls: quad|fpv|fixedwing|loiter|bird|friendly|civilian, hostile, rfEmitting, spawnAtSec, bearingDeg, rangeM, altM, speedMps, behavior: direct|terrain_mask|evasive|loiter|swarm, swarmId?}], roe{requireClassification, minConfidence}, difficulty{threatCount, speed, altitude, evasiveness, ambiguity, degradation, timePressure; all 0-1}, noveltyScore.
- **SessionEvent**: discriminated union on `type`, each with `t` in seconds: observable{threatId} (ground truth, first moment any sensor could see it), detect{threatId}, classify{threatId, cls, confidence, assistantSuggested, assistantCorrect}, rank{order[]}, engage{threatId, effector}, result{threatId, outcome: neutralised|leak|fratricide|wasted|ignored}.
- **SessionLog**: scenarioId, traineeId, events[].
- **ScoringTree**: nodes with id, stage, question, branches[{condition, points, label}], weights per stage (detection 20, classification 25, assessment 15, engagement 30, outcome 10), criticalFails[].
- **ScoreReport**: sessionId, total, byStage, decisions[{threatId, stage, points, max, nodePath[], reason}], competencies{detect, classify, prioritise, engage, roe, trust}, critical[].

### Scaffold interpretation notes

- `classify.assistantSuggested` is true when the trainee's answer matched the AI assistant's suggestion; `assistantCorrect` is whether the assistant's suggestion was right.
- `criticalFails[]` items are `{id, condition, label, scoreCap?}`; `critical[]` in a report items are `{id, threatId?, label}`.
- Branch `condition` is a stable identifier owned by the scoring engine (see `data/scoring-tree.default.json`). Branch `points` is a fraction of the node's per-threat share of the stage weight, in [-1, 1]; negative values are penalties.
- Total score and competencies are on a 0-100 scale.

## Stub contract

- `src/sim/index.ts`: `createWorld(spec)`, `step(world, inputs, dt)`, `getObservations(world)`
- `src/engine/generator.ts`: `generateScenario(seed, difficulty, history): ScenarioSpec`
- `src/engine/scoring.ts`: `scoreSession(spec, log, tree): ScoreReport`
- `src/engine/adaptive.ts`: `updateSkill(profile, report)`, `nextDifficulty(profile)`
- `src/engine/bots.ts`: `runBot(spec, kind: expert|novice|overtrusting): SessionLog`
- `src/sim/prng.ts`: `mulberry32(seed)`, shared by sim and engine.

## Commands

See README.md.
