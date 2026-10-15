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

### Schema v1.1 (tag `schema-v1.1`, additive only)

- `CONDITION_IDS` gained `neutralised_early`, `neutralised_late` and `ammo_heavy`. Nothing was renamed or removed; `neutralised` stays valid.
- `neutralised_early`: (neutralisation time minus observable time) is at most 0.5 times the warning window, the same warning window the detection stage uses. `neutralised_late`: neutralised later than that.
- `ammo_heavy`: the trainee made more than one `engage` event on the threat. For a swarm, engage events are counted once per `swarmId`: the total across all members of that swarm, so every member of a swarm that took more than one engage is heavy, and one engage on a swarm is never heavy.
- Default tree, outcome stage: node `outcome.result` scores `neutralised_early` 1.0 and `neutralised_late` 0.6 in place of the flat `neutralised` branch; node `outcome.ammo` scores `ammo_heavy` -0.2.
- `ammo_heavy` is a modifier applied on top of the timing branch within the same outcome decision, only when the threat was neutralised. Both node ids are recorded in `nodePath`. A custom tree that holds `ammo_heavy` in the same node as the timing branch is applied once and the node id is recorded once. A tree without an `ammo_heavy` branch ignores it.
- A tree that has only the old `neutralised` branch scores neutralisation flat, as before. The scorer tries the timing id, then `neutralised`.
- `ScoreReport` has no new fields. The store keeps `{report, extras}` per session, where `extras` is `AnalysisExtras` exported from `src/engine`. It now also carries `ammoHeavy` (threat ids).

## Stub contract

- `src/sim/index.ts`: `createWorld(spec)`, `step(world, inputs, dt)`, `getObservations(world)`
- `src/engine/generator.ts`: `generateScenario(seed, difficulty, history): ScenarioSpec`
- `src/engine/scoring.ts`: `scoreSession(spec, log, tree): ScoreReport`
- `src/engine/adaptive.ts`: `createProfile(traineeId)`, `updateSkill(profile, report, extras, servedDifficulty)`, `nextDifficulty(profile, seed)`, `examConfig(seed, difficulty)` (not frozen; see the adaptive section)
- `src/engine/bots.ts`: `runBot(spec, kind: expert|novice|overtrusting, options?: {skill, trustBias}): SessionLog`
- `src/shared/prng.ts`: `mulberry32(seed)`

## Sim and client (feat/sim)

- `src/sim` is a mutating world: `step(world, inputs, dt)` updates the world in place and returns it. Time is `tick * dt`, so event times are exact multiples of 0.05.
- Inputs are applied at the start of a step, stamped with `world.t`, then the world advances. The sim echoes valid `detect`, `classify`, `rank` and `engage` inputs as events and emits `observable` and `result` itself.
- `observable` fires the first tick any live sensor's detection range covers the threat. Range depends on sensor type, health, `failAtSec`, weather, time of day, map type, altitude, threat class and `terrain_mask` behaviour; `rf` sees only `rfEmitting` threats.
- Results: hostile reaching an asset is `leak`; jammer or any effective effector on a hostile is `neutralised` after an effect delay (jammer 1 s, gun 1 s, net 2 s, spoofer 3 s, interceptor 4 s); an ineffective effector on a hostile is `wasted` and the hostile stays inbound; engaging a friendly with an effective effector is `fratricide`; engaging a bird or civilian is `wasted`; a non-threat that transits out of range and anything still airborne at the end is `ignored`.
- A jammer that neutralises a swarm member also neutralises every other `rfEmitting` member of the same `swarmId` inside jammer range, each with its own `result`.
- `getObservations(world)` returns only contacts currently seen by a sensor, with noisy position, no class, and the assistant suggestion only after `detect`. `getGroundTruth(world)` is for replay and instructor views.
- `world.rejected` lists inputs the sim refused: `unknown_threat`, `not_active`, `not_visible`, `already_detected`, `not_detected`, `engagement_in_progress`, `no_ammo`, `out_of_range`.
- `finish(world)` ends a session early and emits `ignored` for everything still airborne.
- `replayEvents(spec, log, endedAtSec)` and `worldAtTime(spec, log, t, endedAtSec)` rebuild a world from a log by re-feeding its inputs; a replay of a live log must equal the log.
- Routes: `/play/:examId` and `/replay/:sessionId?t=seconds`. `examId` maps to a seed (numeric ids are used as the seed, other strings are hashed) and the spec comes from `generateScenario` with all difficulty axes at 0.5.
- `src/client/storage.ts` is an interim Dexie store (`dronacharya-client`, table `sessions`: id, examId, traineeId, spec, log, endedAtSec, savedAt). Move to `src/store` when it exists.

## Scoring engine (src/engine)

- `scoreSession(spec, log, tree)` returns the `ScoreReport`; `analyseSession` returns `{report, extras}`. `extras` (type `AnalysisExtras`, exported from `src/engine`) carries what the frozen report has no field for: `kendallTau` (display only, never affects points), `excludedThreatIds`, `droppedStages`, `misses`, `wastedEffort`, `ammoHeavy`, `engageCounts` and `verdicts` (the tree condition chosen per threat and stage, with a modifier such as `ammo_heavy` as its own record).
- The scorer measures facts and picks a condition id from `CONDITION_IDS`; the tree JSON decides every point value. A chosen condition with no branch in the tree scores 0.
- A threat is scored only if the log has an `observable` event for it. First `detect` wins. Classification used is the last `classify` before the first `engage`, or the last overall when never engaged. Only the first `engage` per threat decides. The last `rank` event is the trainee's order. `sessionId` is `${scenarioId}:${traineeId}`.
- Warning window is `max(1, etaImpact - observableAt)`, where etaImpact is the leak time if a leak result exists, otherwise `min(spawnAtSec + rangeM / speedMps, durationSec)`. Reaction bands and rank-distance bands are parsed from the ids `reaction<=X` and `rank_within_N`.
- Optimal order is hostile threats by theoretical ETA ascending, then the value of the nearest asset to the spawn point descending, then id. Non-hostile ids in the trainee's rank are ignored.
- Engagement priority: engaged a non-threat (friendly, bird, civilian), then ROE violation (`engaged_before_confirmation`: no classification before the engage, or confidence below `roe.minConfidence`, when `requireClassification`), then wrong effector (the first result after the engage is `wasted`), then correct. Never engaged: hostile that leaked is `held_fire_on_hostile`; hostile that did not is `ignored_hostile` with zero points and no flag; non-threat is `held_fire_on_nonthreat`.
- An engage that is followed only by a leak, or by nothing, is treated as the right effector arriving too late; the outcome stage carries the penalty.
- Swarm coverage: a member with no engage of its own is covered by the earliest engage on any member with the same `swarmId`. Its ROE check uses the engaged member's classification. Detection and classification stay per member.
- `decisions[].max` is the stage weight divided by the number of threats scored in that stage (hostile only for assessment). Each decision is clamped to `[-max, max]`, each stage to at least 0. A stage with no applicable threats, or no tree node, is dropped and the total is re-normalised over the remaining weights. A dropped stage has competency 50.
- Critical fails come from `tree.criticalFails`: every threat whose chosen condition matches a fail is added to `critical[]`, and a `scoreCap` lowers the total after totalling.
- `competencies.detect|classify|prioritise|engage` are stage points divided by the stage weight, times 100. `roe` is 100 times the share of scored threats whose engagement condition is not `engaged_before_confirmation`, `engaged_friendly`, `engaged_bird` or `engaged_civilian`.
- `trust` is not a tree stage and never part of the total. Per classify event: followed and wrong is -1, overrode and wrong is +1, followed and right is +0.5, overrode and right is -0.25. `trust = clamp(50 + 50 * mean, 0, 100)`; with no classify events it is 50.

## Generator, bots and scripted scenarios (src/engine)

- `generateScenario(seed, difficulty, history)` is deterministic from `seed`, `difficulty` and `history`, uses only `mulberry32`, and always returns a spec that passes `ScenarioSpecSchema`. Generated ids are `scn-<seed>`, or `scn-<seed>-r<k>` when a novelty re-roll was kept; `spec.seed` is the sub-seed that produced it.
- Difficulty mapping (each axis 0 to 1): `threatCount` gives 2 to 20 individual threats, plus a swarm of 3 to 9 members from 0.55 up, spawned within a fraction of a second of each other under one `swarmId`; `speed` scales hostile speed by 0.75 to 1.3; `altitude` lowers hostile altitude by up to 75%; `evasiveness` is the share of hostiles using `evasive` or `terrain_mask`; `ambiguity` raises the share of non-threats (bird, civilian, friendly) from about 10% to 60% of individual threats, raises the share of RF-silent hostiles, and raises `roe.minConfidence` from 0.5 to 0.7; `degradation` lowers sensor health and, from 0.35, sets one `failAtSec` on radar or eoir between 35% and 65% of the duration; `timePressure` shortens the duration and the spawn-to-impact windows.
- `Difficulty` has no `axes` field in schema v1.1, so the number of distinct approach bearing sectors (1 to 6, 60 degrees each) is derived from the mean of `threatCount` and `timePressure`.
- `mapType`, `timeOfDay` and `weather` are drawn from the seed. Night and fog affect sensors through the sim, not through the generator.
- Every spec has radar, eoir and rf sensors, one to three assets near the origin and a five-effector loadout (jammer, gun, net, spoofer, interceptor). `rfEmitting` per class: quad and fpv emit unless chosen RF-silent, fixedwing and loiter are silent, bird is silent, friendly and civilian emit.
- Solvability (`checkSolvability(spec, {dynamic})` in `solvability.ts`): every hostile has an effective effector with ammo (jammer only against an `rfEmitting` quad, fpv or friendly; gun and the other effectors by the class table); total ammo of useful effectors covers the engagements needed (a fully RF-emitting swarm counts as one jam); at difficulty 0.8 or below, the lead time from entering the best effective effector's range to arrival, minus the effect delay, is at least 6 s. The dynamic check runs the expert bot and requires every hostile to be observable and neutralised with no leak. The generator retries with derived sub-seeds and progressively relieved degradation and evasiveness until a candidate passes.
- Novelty (`noveltyOf(spec, history)`): the minimum over the last 8 history specs of a weighted distance in [0, 1] over the bearing-sector histogram (0.2), spawn-time histogram (0.15), class mix (0.2), map, time of day and weather mismatch (0.3), and the seven difficulty axes (0.15). Empty history is 1. Below 0.25 the generator re-rolls up to 10 sub-seeds and keeps the most novel valid candidate.
- `runBot(spec, kind)` drives the real sim: `createWorld`, then `getObservations` each 50 ms tick to decide `SimInput`s, then `finish`. The log is `world.events`, so `observable` and `result` events are real. Bots are deterministic from `spec.seed` plus the bot kind, and `replayEvents(spec, log)` reproduces the log exactly.
- Expert: detects 1 to 2 s after a contact appears, classifies correctly (confidence 0.85 to 0.95), ranks hostiles by theoretical ETA then asset value, engages with the fastest effective effector in range, holds fire on non-threats, and assesses a whole swarm before a single jam. Novice: detects after 5 to 12 s, correct about 60% of the time at low confidence, engages believed threats without regard to the ROE, sometimes engages anything or picks a random effector, ranks at random. Overtrusting: classifies as the assistant suggests, otherwise behaves like the expert.
- Ten scripted scenarios live in `data/scenarios/*.json` and load through `loadScripted(name)` in `src/engine/scripted.ts`. Each validates against the schema, is solvable, and the expert scores at least 70.
- CLI: `pnpm sim:run --seed 1 --bot expert --difficulty 0.5` generates and runs one scenario; `--scripted <name>` runs a scripted one instead.

## Store, adaptive engine, training and demo data

### Import surface for Person A

`import { saveSession, resolveExam, ... } from '../store'` (everything below is exported from `src/store/index.ts`). The store is a Dexie database named `dronacharya-store`; it supersedes the interim `src/client/storage.ts`.

- `saveSession({spec, log, endedAtSec, traineeId, unitId}): Promise<string>` runs `analyseSession` with the default tree, stores `{report, extras}`, updates the skill profile with `updateSkill`, creates the unit and trainee rows if missing, and returns the session id `${scenarioId}:${traineeId}:${n}`, where `n` is 1 plus that trainee's earlier sessions on that scenario. `report.sessionId` is that id.
- `getSession(id)`, `listSessions(traineeId)` (oldest first), `listUnitReports(unitId)` (`{sessionId, traineeId, scenarioId, createdAt, report, extras}` oldest first).
- `getProfile(traineeId)`, `saveProfile(profile)`.
- `createExam({id, unitId, seed, difficulty})`, `listExams(unitId)`.
- `resolveExam(examId): Promise<ScenarioSpec>` looks `examId` up in the `exams` table and uses its seed and difficulty; for an unknown id it uses `generateScenario(seed, 0.5 on every axis, [])`, where an all-digit id of up to 9 digits is the seed itself and any other string is hashed with the same FNV-1a function the client uses (`seedForExam`). History is always empty so every trainee gets the identical scenario.
- `listUnits()`, `listTrainees(unitId)`, `saveUnit`, `saveTrainee`.
- `runTrainingLoop(traineeId, unitId, {sessions, skill, trustBias, seed, learningRate?, exam?})` runs `simulateTraining` from the stored profile and persists every session through `saveSession`.
- `importDemoData(json)` validates against `DemoDataSchema` and adds only rows whose ids do not exist (idempotent); it returns the number added per table. `resetDemoData()` deletes every row whose id, or trainee id for sessions and profiles, starts with `demo-`.
- Tables: `trainees`, `units`, `exams`, `sessions` (`{id, traineeId, unitId, scenarioId, spec, log, endedAtSec, report, extras, createdAt}`), `skillProfiles`. `Date.now` is used only for `createdAt`.

### Adaptive engine (`src/engine/adaptive.ts`, pure and deterministic)

- Profile: Elo `ratings` for `detect`, `classify`, `prioritise`, `engage`, `roe`, `trust`, all starting at 1000, controller `levels` and `smoothed` scores per competency, `sessions`, and a `history` of `{difficulty, competencies, ratings, levels}` per session. Profiles stored before the controller have no `levels` or `smoothed`; they load with the defaults.
- Knob level per competency: detect is the mean of `speed`, `timePressure`, `altitude`, `degradation`; classify the mean of `ambiguity`, `degradation`; prioritise the mean of `threatCount`, `timePressure`; engage the mean of `threatCount`, `evasiveness`, `timePressure`; roe is `ambiguity`; trust is `(0.5 * ambiguity + 0.2 * degradation) / 0.7`. The trust mapping follows `src/sim`, where the assistant's error rate is `1 - clamp(0.95 - 0.5 * ambiguity - 0.2 * degradation, 0.3, 0.99)`, so it depends on degradation as well as ambiguity.
- `updateSkill` (Elo, unchanged): `score = competency / 100`, `reference = 700 + 600 * level`, `expected = 1 / (1 + 10^((reference - rating) / 400))`, `rating += K * (score - expected)` with `K = 100` for a trainee's first 3 sessions, 60 for sessions 4 to 8 and 40 after (`kFactor(completedSessions)`). A competency is skipped when its stage is in `extras.droppedStages` (detect is detection, classify is classification, prioritise is assessment, engage is engagement, roe is skipped with engagement); trust is skipped when `extras.trustSamples` is 0. `AnalysisExtras.trustSamples` counts the classify events. It returns a new profile.
- Difficulty control is a proportional controller, separate from the Elo ratings. The profile carries a `level` per competency (initial 0.3) and a `smoothed` score per competency (initial 0.75). For each competency scored in a session (same skip rules as the Elo update): `smoothed = 0.5 * smoothed + 0.5 * (score / 100)`, `step = clamp(0.6 * (smoothed - 0.75), -0.12, +0.12)`, `level = clamp(level + step, 0.05, 0.95)`. The setpoint is a smoothed score of 0.75, so a trainee who scores above it is served harder scenarios and one below it easier ones. Each history entry also stores the `levels` after the session.
- `nextDifficulty(profile, seed)`: each knob takes the mean `level` of the competencies that own it (same ownership as above). The weakest competency by Elo rating adds +0.1 to the knobs it owns. With probability 0.1 per scenario every knob is jittered by a seeded uniform value in [-0.1, 0.1]. Everything is clamped to [0, 1]. The result has the seven schema fields only; there is no `axes` field. The Elo ratings are the dashboard's skill estimate and pick the weakest competency; they no longer set the difficulty.
- `examConfig(seed, difficulty)` returns a fixed `{seed, difficulty}` copy so a whole unit takes an identical test.

### Skill-parameterised bot and training

- `runBot(spec, kind, {skill, trustBias})` interpolates every behaviour between a novice (skill 0) and the expert (skill 1): classification accuracy (0.6 to 1), confidence, the chance of engaging a believed non-threat (0.2 to 0), the chance of choosing a random effector (0.25 to 0), the chance of using the true RF-emitter flag and the chance of assessing a swarm before jamming (both skill), classify and engage delays (novice to expert), the detection delay (20 to 60 s at skill 0, 1 to 2 s at skill 1) and rank noise `(1 - skill)^2` (1 is a random order, 0 the optimal order). The skill-0 detection delay is deliberately slower than the named novice kind (5 to 12 s): the scorer measures delay as a fraction of a warning window of about 100 s, so a 5 to 30 s delay still lands in the top band, the worst bot would score about 82 on detect, and the controller would keep raising the detect knobs for a trainee who is poor everywhere else. With 20 to 60 s a skill 0 bot is served 0.12 in sessions 9 to 12. `trustBias` is the probability of following the assistant regardless of own judgement; `followedAssistant` is then set by the sim. Without the third argument the three named kinds behave exactly as before. Extra random draws use a second seeded stream so the original draws are unchanged.
- `simulateTraining({traineeId, sessions, skill, trustBias, learningRate = 0.04, seed, profile?, history?, exam?})` needs no database. Each session generates a scenario from `nextDifficulty` and the recent specs, runs the skilled bot, scores it, updates the profile, then raises the bot's skill by `learningRate` and lowers `trustBias` by 0.03, both clamped to [0, 1]. `exam: {sessionIndex, seed, difficulty}` replaces that session with `generateScenario(seed, difficulty, [])`.

### Demo data

- `pnpm seed:demo` writes `data/demo/demo-data.json`: units Alpha and Bravo, four trainees each with starting skills 0.1 to 0.6 and varied trust bias, 12 sessions each at learning rate 0.05, one shared exam per unit taken at session 12 on the unit's common seed at difficulty 0.4 on every axis, and every skill profile. It is deterministic and about 1.6 MB. The committed file must equal `buildDemoData()`; a test checks this.
- Exam level: a common exam is a fixed point on every trainee's chart, so it is set to 0.4, about where an average trainee has arrived by session 12. At 0.5 the exam sat above most trainees' adaptive level and pulled the session 10 to 12 mean down (4 of 12 base seeds met the acceptance bar; 12 of 12 at 0.4). The exam session therefore shows a fixed difficulty of 0.4 on the difficulty chart.
- `pnpm curriculum:check` compares adaptive, three fixed ladders (start 0.2, +0.02, +0.04, +0.06 per session), a constant 0.5 and random difficulty on 30 seeded synthetic trainees (start skill U(0.1, 0.5), learning rate U(0.02, 0.08), 15 sessions) under two assumed learner models: `skill += rate * max(0, 1 - tolerance * |served - comfortable|)` with comfortable `0.15 + 0.7 * skill` and tolerance 2.5 (model A) or `0.1 + 0.6 * skill` and tolerance 2.0 (model B). Both are assumptions, labelled as such in the output. It prints mean and 10th percentile final skill, mean total of the last 3 sessions and mean served difficulty for each curriculum, and states plainly whether adaptive beats the best fixed ladder.
- Load it in the app with `importDemoData(await (await fetch('/demo-data.json')).json())` or import the JSON directly; `buildDemoData()` rebuilds it in memory.

## Commands

See README.md.
