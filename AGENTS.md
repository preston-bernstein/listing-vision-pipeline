# Core rules for agents (core pack)

## Commands

- The one gate: `bash scripts/core-validate.sh` (file size, names, complexity, function length, parameters, nesting, duplication). Run it before you say a task is done.

## Rules

- Reuse before you write. Search for an existing function or module first. Extend it instead of adding a near copy.
- Put variants in data and in generic code, not in copies. When two things differ only in a type or a value, write one function that takes the type or the value.
- Extract on the second real occurrence, not the first guess. Never merge code that looks alike but belongs to different domains.
- No boolean flag arguments. Two behaviors are two functions.
- Organize by domain (orders, billing, auth), not by kind (utils, helpers, managers). Dependencies point one way: edge to domain, never back.
- A function does one thing at one level of detail. Use guard clauses to return early. Keep it under 50 lines, under 10 branches, at most 4 parameters.
- Names say what a thing is or does. No `data`, `info`, `tmp`, `handle`, `process` as a whole name.
- Prefer composition and plain functions to inheritance. Keep side effects at the edges.
- Fail loudly: return or raise an error with context. Never swallow one. Comments say why, not what.
- Delete dead code and unused options. Concise means fewer concepts, not shorter names.
- A behavior change ships with a test that fails without it. Do not edit generated files; change the generator.
- Never edit a limit or a config to make a run pass. Fix the code. A waiver goes in `.core-allow` with a reason.
- There is no `.core-baseline.json`: no function is over a limit. Do not add one.
- `scripts/core-*`, `scripts/gha-*`, `scripts/js-*`, `scripts/ts-*`, `scripts/pg-*`, `scripts/writing-*`, `scripts/vale-central.ini` and `scripts/styles` are copies of the pack files. Do not edit them.

## All gates

Run `bash scripts/gates.sh` to run every gate. CI and the pre-commit hook run the same script.

| Pack | Command |
| --- | --- |
| core | `bash scripts/core-validate.sh` |
| github-actions | `bash scripts/gha-validate.sh` |
| javascript-node | `bash scripts/js-validate.sh` |
| typescript | `bash scripts/ts-validate.sh` |
| postgres | `bash scripts/pg-validate.sh` |
| writing | `bash scripts/writing-validate.sh` |

Gate tools are pinned in `ci-tools/` and `.github/workflows/ci.yml`. Install: `pip install --require-hashes -r ci-tools/requirements.txt` and `npm ci --prefix ci-tools`.

Run `git config core.hooksPath .githooks` once per clone (`npm install` does it). Never commit with `--no-verify`.

## GitHub Actions

- Pin every `uses:` to a full 40-character commit SHA with the version in a trailing comment.
- Set `permissions: contents: read` at the top of every workflow. Raise it per job only where needed.
- Never put `${{ github.event... }}` or `${{ inputs.x }}` inside `run:`. Pass it through `env:`.
- `actions/checkout` gets `persist-credentials: false`. Every job has `timeout-minutes`.

## JavaScript, TypeScript and Node

- Install with `npm ci`. Do not add a dependency without asking. Do not add install scripts.
- Await or return every promise. Throw `Error` objects. No `any`; use `unknown` and narrow it.
- Parse outside data with a schema. Read config once at startup.
- Do not edit the ESLint config or `.npmrc` to make a run pass.
- The root has no `tsconfig.json`, so `ts-validate.sh` has nothing to check. Each package runs `tsc` through `npm run typecheck`.

## Postgres

This repo uses SQLite through Drizzle. `pg-validate.sh` skips SQLite files. If a Postgres migration appears, the pack rules apply: never edit an applied migration, and start each one with `set lock_timeout`.

## Writing

Docs and comments are short, plain, American English. `bash scripts/writing-validate.sh` lints files that changed against `main`. A false positive goes in `.writing-allow` with a reason.
