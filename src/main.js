import * as core from "@actions/core";
import { RollfuseClient } from "@rollfuse/sdk-js";

/**
 * Rejects after timeoutMs, independently of whatever bound
 * `@rollfuse/sdk-js`'s own `RollfuseClient.start()` applies internally.
 * Deliberate defence at both layers (design.md decision "Initialization
 * is bounded, and the Action is bounded independently"): a workflow
 * pinned to an older `@rollfuse/sdk-js` version that predates its own
 * bounded-initialization fix would otherwise still hang this job until
 * the platform's own request timeout — minutes, not this action's
 * default of 15 seconds — costing a customer a stalled runner rather than
 * a fast, loud gate failure.
 */
function timeoutAfter(timeoutMs) {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms waiting for the platform to respond`));
    }, timeoutMs);
    timer.unref?.();
  });
}

/**
 * Bounds `client.close()` to at most closeTimeoutMs. Found empirically
 * while testing the `timeout-ms` bound above: `close()` still waits for
 * whatever in-flight request `start()` left pending (an older, unbounded
 * `@rollfuse/sdk-js` version has no deadline on that request at all), so
 * without this, a gate that had already failed and reported why at, say,
 * 300ms could still leave the job step itself hanging for several more
 * seconds waiting on a close() this action does not need to wait for —
 * the gate's outcome (setFailed/setOutput) is already final by the time
 * close() is even called.
 */
async function closeWithTimeout(client, closeTimeoutMs) {
  await Promise.race([
    client.close(),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, closeTimeoutMs);
      timer.unref?.();
    }),
  ]);
}

/** Bound on the best-effort client.close() in run()'s `finally` — see closeWithTimeout's own doc comment. */
const CLOSE_TIMEOUT_MS = 2_000;

/**
 * Deliberately never passes a `fallback` to `client.evaluate` — a
 * fallback makes @rollfuse/sdk-js treat "no Configuration cached yet" and
 * "flag key not found" as success (a synthesized default_fallback
 * result) instead of throwing ConfigNotReadyError/FlagNotFoundError. For
 * a gate action whose whole purpose is blocking a pipeline step, that
 * would be exactly backwards: an unreachable API or a mistyped flag key
 * should fail the gate closed, not silently let it pass. See
 * rollfuse/openfeature-provider's README for the same reasoning applied
 * to that adapter.
 */
export async function run() {
  const flagKey = core.getInput("flag", { required: true });
  const wantVariation = core.getInput("want-variation") || "on";
  const subjectKey = core.getInput("subject") || "ci";
  const baseUrl = core.getInput("base-url") || "https://api.rollfuse.com";
  const credential = core.getInput("credential", { required: true });
  const attributesInput = core.getInput("attributes") || "{}";
  const timeoutMsInput = core.getInput("timeout-ms") || "15000";
  const timeoutMs = Number(timeoutMsInput);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    core.setFailed(`\`timeout-ms\` input must be a positive number, got "${timeoutMsInput}"`);
    return;
  }

  let attributes;
  try {
    attributes = JSON.parse(attributesInput);
  } catch (err) {
    core.setFailed(`\`attributes\` input is not valid JSON: ${err.message}`);
    return;
  }

  const client = new RollfuseClient({ baseUrl, credential });

  try {
    await Promise.race([client.start(), timeoutAfter(timeoutMs)]);

    const result = client.evaluate(subjectKey, flagKey, { attributes });
    const passed = result.variation_key === wantVariation;

    core.setOutput("variation", result.variation_key);
    core.setOutput("reason", result.reason);
    core.setOutput("value", JSON.stringify(result.value));
    core.setOutput("passed", String(passed));

    core.info(`rollfuse: ${flagKey} = "${result.variation_key}" for subject "${subjectKey}" (reason: ${result.reason})`);

    if (!passed) {
      core.setFailed(`Gate blocked: wanted variation "${wantVariation}", got "${result.variation_key}"`);
    }
  } catch (err) {
    core.setFailed(`rollfuse evaluation failed: ${err.message}`);
  } finally {
    await closeWithTimeout(client, CLOSE_TIMEOUT_MS);
  }
}

/* c8 ignore start -- exercised by __tests__, not by this entrypoint guard itself */
if (process.env.NODE_ENV !== "test") {
  run();
}
/* c8 ignore stop */
