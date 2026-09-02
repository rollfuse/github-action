import * as core from "@actions/core";
import { RollfuseClient } from "@rollfuse/sdk-js";

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

  let attributes;
  try {
    attributes = JSON.parse(attributesInput);
  } catch (err) {
    core.setFailed(`\`attributes\` input is not valid JSON: ${err.message}`);
    return;
  }

  const client = new RollfuseClient({ baseUrl, credential });

  try {
    await client.start();

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
    await client.close();
  }
}

/* c8 ignore start -- exercised by __tests__, not by this entrypoint guard itself */
if (process.env.NODE_ENV !== "test") {
  run();
}
/* c8 ignore stop */
