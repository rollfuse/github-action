# Project Context

## Product

**github-action** is the official GitHub Action for **rollfuse**, a
developer-first feature-flag and progressive-delivery platform: gate a
workflow step on a flag (`uses: rollfuse/github-action@v1`), a kill
switch for a deploy or any other pipeline step. The platform itself
(API, web console, SDKs) lives in `rollfuse/rollfuse`, `rollfuse/go-sdk`,
`rollfuse/js-sdk`.

## What This Action Does

Wraps a single `@rollfuse/sdk-js` `client.evaluate()` call: resolves one
flag for one subject key, sets `variation`/`reason`/`value`/`passed`
outputs, and fails the step (non-zero) if the resolved variation doesn't
match the `want-variation` input. No evaluation logic of its own — every
actual decision comes from the wrapped SDK's local, deterministic
evaluation against a cached Configuration.

## Engineering Priorities

1. Fails closed — an unreachable API, wrong credential, or unknown flag
   key must block the gate (fail the step), never silently pass. This is
   the one property most worth protecting in any change to this repo.
2. `dist/index.js` (the committed, ncc-bundled artifact `action.yml`
   actually runs) must always match `src/main.js` — a stale `dist/`
   means consumers run different code than what's in `src/`, silently.
3. Maintainability
4. Startup latency (a JS Action, not a Docker action, specifically to
   avoid container pull/build overhead on every invocation)

## Architecture Constraints

- No dependency beyond `@actions/core` and `@rollfuse/sdk-js` (plus
  `@vercel/ncc` as a dev-only bundler).
- `action.yml`'s inputs/outputs are this action's public contract — a
  breaking change to either (renaming, removing, changing meaning)
  requires a major version bump and moving the `v1`-style tag
  accordingly (see README.md's "Releasing a new major version").
- Never introduce a build step a *consumer* has to run — `dist/` is
  committed precisely so `uses: rollfuse/github-action@v1` works with
  zero setup.

## Repository Shape

```text
/
├── action.yml              Inputs, outputs, and `main: dist/index.js`.
├── src/main.js              The actual implementation (readable source).
├── dist/index.js            The committed, ncc-bundled artifact — what
│                             action.yml actually runs. Rebuild via
│                             `npm run build`; CI enforces it's current.
├── __tests__/main.test.js   Unit tests (node:test), a real node:http
│                             mock rollfuse API, no framework.
├── scripts/mock-rollfuse-api.mjs   Used only by
│                                   .github/workflows/self-test.yml,
│                                   which exercises the *packaged* action
│                                   (`uses: ./`) end to end.
└── openspec/
```

## Specification Rules

- This repository has no `openspec/specs/` capability of its own — its
  correctness contract is `action.yml`'s inputs/outputs plus
  `@rollfuse/sdk-js`'s own behavioral contract (tracked in
  `rollfuse/js-sdk`). A question about evaluation behavior itself belongs
  there, not here.
- `openspec/changes/` here is for planning nontrivial changes to the
  action itself (a new input, a new failure mode) — not for specifying
  rollfuse platform behavior.
