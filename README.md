# DronAcharya

Browser-based drone and counter-drone threat simulation trainer (SIH PS 26247). Runs fully offline in the browser; all data stays in IndexedDB.

## Requirements

- Node 20+
- pnpm

On Windows without symlink permission, `pnpm-workspace.yaml` sets `nodeLinker: hoisted` so installs work without Developer Mode.

## Commands

| Command                                               | What it does                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install`                                        | Install dependencies                                                                |
| `pnpm dev`                                            | Start the Vite dev server                                                           |
| `pnpm build`                                          | Typecheck and build the static site into `dist/`                                    |
| `pnpm preview`                                        | Serve the production build locally                                                  |
| `pnpm test`                                           | Run vitest                                                                          |
| `pnpm typecheck`                                      | Run `tsc --noEmit`                                                                  |
| `pnpm lint`                                           | Run eslint                                                                          |
| `pnpm format`                                         | Run prettier                                                                        |
| `pnpm seed:demo`                                      | Regenerate `data/demo/demo-data.json` (2 units, 8 trainees, 96 sessions)            |
| `pnpm demo:check`                                     | Validate the demo data against the schema                                           |
| `pnpm sim:run --seed 1 --bot expert --difficulty 0.5` | Generate, bot-play and score one scenario (`--scripted <name>` runs a scripted one) |

`--bot` is one of `expert`, `novice`, `overtrusting`.

## Routes

- `/` home: Trainee, Review and Instructor entry points, recent sessions
- `/play/:examId` trainee start screen and session
- `/replay/:sessionId?t=seconds` replay with ground truth and event timeline
- `/review`, `/debrief/:sessionId`, `/progress/:traineeId`, `/unit/:unitId` after-action review

## Layout

- `src/schema` shared zod schemas and types (frozen; change only by agreement)
- `src/shared` seeded PRNG (frozen with the schema)
- `src/sim` deterministic simulation
- `src/client` React and three.js front end
- `src/engine` scenario generator, scoring, adaptive difficulty, bots
- `src/store` dexie persistence, the only store
- `src/dashboard` after-action review
- `src/instructor` instructor tools
- `data/` scoring tree and scenario data
- `scripts/sim-run.ts` the `sim:run` CLI

## Deploying

`pnpm build` produces a static site in `dist/` that Vercel serves as-is.
