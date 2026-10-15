# DronAcharya

Browser-based drone and counter-drone threat simulation trainer (SIH PS 26247). Runs fully offline in the browser; all data stays in IndexedDB.

## Requirements

- Node 20+
- pnpm

On Windows without symlink permission, `pnpm-workspace.yaml` sets `nodeLinker: hoisted` so installs work without Developer Mode.

## Commands

| Command                              | What it does                                        |
| ------------------------------------ | --------------------------------------------------- |
| `pnpm install`                       | Install dependencies                                |
| `pnpm dev`                           | Start the Vite dev server                           |
| `pnpm build`                         | Typecheck and build the static site into `dist/`    |
| `pnpm preview`                       | Serve the production build locally                  |
| `pnpm test`                          | Run vitest                                          |
| `pnpm typecheck`                     | Run `tsc --noEmit`                                  |
| `pnpm lint`                          | Run eslint                                          |
| `pnpm format`                        | Run prettier                                        |
| `pnpm sim:run --seed 1 --bot expert` | Generate, simulate, bot-play and score one scenario |

`--bot` is one of `expert`, `novice`, `overtrusting`.

## Layout

- `src/schema` shared zod schemas and types (frozen; change only by agreement)
- `src/sim` deterministic simulation (Person A)
- `src/client` React and three.js front end (Person A)
- `src/engine` scenario generator, scoring, adaptive difficulty, bots (Person B)
- `src/store` zustand and dexie persistence (Person B)
- `src/dashboard` after-action review (Person B)
- `src/instructor` instructor tools (Person B)
- `data/` scoring tree and scenario data (Person B)
- `scripts/sim-run.ts` the `sim:run` CLI

## Deploying

`pnpm build` produces a static site in `dist/` that Vercel serves as-is.
