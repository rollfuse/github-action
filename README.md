# rollfuse Flag Gate — the official GitHub Action

Gate a workflow step on a [rollfuse](https://rollfuse.com) feature flag —
a kill switch for a deploy, or any other pipeline step — in one `uses:`
line, no CLI to install or build yourself.

```yaml
- name: rollfuse flag gate
  uses: rollfuse/github-action@v1
  with:
    flag: deploys-enabled
    want-variation: "on"
    credential: ${{ secrets.ROLLFUSE_SERVICE_CREDENTIAL }}

- name: deploy
  run: ./deploy.sh
  # never runs if the step above blocked the gate — GitHub Actions
  # stops the job on a failed step by default
```

## Inputs

| Input | Required | Default | Purpose |
|---|---|---|---|
| `flag` | yes | — | The flag key to evaluate |
| `credential` | yes | — | A rollfuse Service Credential (`config:read` scope) — pass a secret, never a literal |
| `want-variation` | no | `"on"` | The variation key that means "pass" |
| `subject` | no | `"ci"` | The subject key to evaluate for |
| `attributes` | no | `"{}"` | JSON object of evaluation attributes, e.g. `'{"environment":"production"}'` |
| `base-url` | no | `https://api.rollfuse.com` | The rollfuse API base URL |

## Outputs

| Output | Example | Meaning |
|---|---|---|
| `variation` | `"on"` | The resolved variation key |
| `reason` | `"rule_match"` | Why that variation was resolved (`rule_match`, `default_disabled`, `default_no_rule_match`, `default_fallback`) |
| `value` | `"true"` | The resolved variation's value, JSON-encoded |
| `passed` | `"true"` | `"true"` if `variation` matched `want-variation` |

## Fails closed, on purpose

This action never masks an unreachable API or an unknown flag key behind
a fallback value — if the flag can't be resolved for any reason (network
error, wrong credential, typo'd flag key), the step fails, the same as a
blocked gate. For a kill switch, "I couldn't tell if the flag was on" and
"the flag is off" should have the same effect: don't proceed. See
`src/main.js`'s doc comment (and
[`rollfuse/openfeature-provider`](https://github.com/rollfuse/openfeature-provider)'s
README, which makes the identical choice for the same reason) if you're
wondering why this doesn't just pass `fallback` to make errors "go away."

## Why a flag gate instead of a hardcoded `if:` condition

A flag gives you what `if: github.ref == 'refs/heads/main'` can't:
change the gate's outcome **without touching the workflow file or making
a new commit** — flip it from the rollfuse console (or wire it to the
same guardrail automation that already pauses a rollout), and the very
next workflow run picks it up. A manual freeze switch during an incident,
or an automated one, from one place.

## Development

This is a JavaScript Action — `action.yml`'s `main` points directly at
the committed `dist/index.js` (bundled via `@vercel/ncc`), so **`dist/`
must always be committed and up to date with `src/`**; CI's
`npm run check-dist` fails the build otherwise.

```bash
npm install
npm test              # node's built-in test runner, node:http-based mock API
npm run build          # rebuilds dist/index.js
npm run check-dist     # rebuilds and fails if dist/ doesn't match what's committed
```

`.github/workflows/self-test.yml` exercises the *packaged* action
(`uses: ./`) against a real subprocess for both outcomes — a passing gate
and a blocked one — using `scripts/mock-rollfuse-api.mjs`, a
self-contained stand-in for the real platform API, the same pattern every
example repo in this org uses.

### Releasing a new major version

Consumers pin `uses: rollfuse/github-action@v1` — a major-version tag,
not a specific commit — per GitHub's own convention for Actions. After
merging to `main`:

```bash
git tag -f v1 <commit>   # move the v1 tag to the new commit
git push -f origin v1
git tag vX.Y.Z <commit>  # also tag the specific version, for changelog reference
git push origin vX.Y.Z
```

## Related

- [`rollfuse/examples-github-actions`](https://github.com/rollfuse/examples-github-actions) —
  the same kill-switch pattern as a plain CLI + workflow example, useful
  if you're not on GitHub Actions or want the pattern in another CI
  system.
- [`rollfuse/js-sdk`](https://github.com/rollfuse/js-sdk) — the SDK this
  action runs (`@rollfuse/sdk-js`).
