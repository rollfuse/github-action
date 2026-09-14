import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.NODE_ENV = "test";

const FLAG_CONFIG = {
  environment_id: "env_test",
  version: 1,
  flags: [
    {
      flag_key: "deploys-enabled",
      enabled: true,
      default_variation: "on",
      variations: [
        { key: "on", value: true },
        { key: "off", value: false },
      ],
      rules: [],
    },
    {
      flag_key: "checkout-redesign",
      enabled: true,
      default_variation: "off",
      variations: [
        { key: "on", value: true },
        { key: "off", value: false },
      ],
      rules: [{ conditions: [{ attribute: "plan", value: "enterprise" }], outcome: { variation_key: "on" } }],
    },
  ],
};

function startMockApi() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/config") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(FLAG_CONFIG));
        return;
      }

      if (req.method === "POST" && req.url === "/v1/exposure-events") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(202);
        res.end(JSON.stringify({ accepted: 1 }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function withInputs(inputs, fn) {
  const prevEnv = { ...process.env };

  for (const [key, value] of Object.entries(inputs)) {
    process.env[`INPUT_${key.toUpperCase()}`] = value;
  }

  return fn().finally(() => {
    for (const key of Object.keys(inputs)) {
      const envKey = `INPUT_${key.toUpperCase()}`;
      if (envKey in prevEnv) {
        process.env[envKey] = prevEnv[envKey];
      } else {
        delete process.env[envKey];
      }
    }
  });
}

// Captures core.setOutput/setFailed by reading GITHUB_OUTPUT (the modern
// @actions/toolkit mechanism — setOutput appends to the file at that
// path) and by checking process.exitCode, which core.setFailed sets to 1
// without actually calling process.exit (so tests can observe it safely).
async function runAction(inputs) {
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const outputFile = path.join(os.tmpdir(), `gh-output-${Math.random().toString(36).slice(2)}`);
  await fs.writeFile(outputFile, "");
  process.env.GITHUB_OUTPUT = outputFile;
  process.exitCode = undefined;

  await withInputs(inputs, async () => {
    const { run } = await import(`../src/main.js?t=${Date.now()}`);
    await run();
  });

  const outputContents = await fs.readFile(outputFile, "utf8");
  const outputs = {};

  // @actions/core's setOutput format (GITHUB_OUTPUT mode) is
  // `${name}<<${delimiter}\n${value}\n${delimiter}\n`, one block per
  // call — parse blocks rather than assuming single-line `key=value`.
  const blockRe = /^(\S+)<<(\S+)\n([\s\S]*?)\n\2$/gm;
  let m;
  while ((m = blockRe.exec(outputContents))) {
    outputs[m[1]] = m[3];
  }

  await fs.unlink(outputFile).catch(() => {});

  const failed = process.exitCode === 1;

  // core.setFailed sets process.exitCode without calling process.exit, so
  // it leaks into whatever runs next — reset it or a later passing test
  // (or the test file's own final exit status) inherits a stale failure.
  process.exitCode = 0;

  return { outputs, failed };
}

test("gate passes when the flag matches want-variation", async () => {
  const server = await startMockApi();
  const { port } = server.address();

  try {
    const { outputs, failed } = await runAction({
      flag: "deploys-enabled",
      "want-variation": "on",
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
    });

    assert.equal(failed, false);
    assert.equal(outputs.variation, "on");
    assert.equal(outputs.passed, "true");
  } finally {
    server.close();
  }
});

test("gate fails (non-zero) when the flag doesn't match want-variation", async () => {
  const server = await startMockApi();
  const { port } = server.address();

  try {
    const { outputs, failed } = await runAction({
      flag: "deploys-enabled",
      "want-variation": "off",
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
    });

    assert.equal(failed, true);
    assert.equal(outputs.variation, "on");
    assert.equal(outputs.passed, "false");
  } finally {
    server.close();
  }
});

test("attributes are passed through to evaluation (rule match)", async () => {
  const server = await startMockApi();
  const { port } = server.address();

  try {
    const { outputs, failed } = await runAction({
      flag: "checkout-redesign",
      "want-variation": "on",
      subject: "user_1",
      attributes: JSON.stringify({ plan: "enterprise" }),
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
    });

    assert.equal(failed, false);
    assert.equal(outputs.variation, "on");
    assert.equal(outputs.reason, "rule_match");
  } finally {
    server.close();
  }
});

test("fails closed when the flag doesn't exist (no fallback masking the error)", async () => {
  const server = await startMockApi();
  const { port } = server.address();

  try {
    const { failed } = await runAction({
      flag: "does-not-exist",
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
    });

    assert.equal(failed, true);
  } finally {
    server.close();
  }
});

test("invalid attributes JSON fails clearly", async () => {
  const server = await startMockApi();
  const { port } = server.address();

  try {
    const { failed } = await runAction({
      flag: "deploys-enabled",
      attributes: "{not json",
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
    });

    assert.equal(failed, true);
  } finally {
    server.close();
  }
});

test("`timeout-ms` input must be a positive number", async () => {
  const { failed } = await runAction({
    flag: "deploys-enabled",
    "base-url": "http://127.0.0.1:1",
    credential: "test-credential",
    "timeout-ms": "not-a-number",
  });

  assert.equal(failed, true);
});

/**
 * Accepts the TCP connection but never writes a response — a genuine
 * hang, distinct from connection-refused (which fails fast on its own).
 * This is exactly what an unreachable-but-listening platform, or a
 * misbehaving proxy, produces.
 */
function startHangingServer() {
  return new Promise((resolve) => {
    const server = createServer(() => {
      // Deliberately never calls res.end() or res.writeHead(): the
      // connection just sits open.
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("task 2.5: fails promptly (bounded by timeout-ms), not by hanging until the platform's own timeout, against an unreachable-but-listening platform", async () => {
  const server = await startHangingServer();
  const { port } = server.address();

  try {
    const startedAt = Date.now();
    const { failed } = await runAction({
      flag: "deploys-enabled",
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
      // Far shorter than @rollfuse/sdk-js's own ~15s default
      // initialization bound, proving this action's own independent
      // timeout is what fired, not the library's.
      "timeout-ms": "300",
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(failed, true);
    // Generous upper bound for CI scheduling jitter; still an order of
    // magnitude below the library's own ~15s default and far below what
    // running to the platform's own request timeout would take.
    assert.ok(elapsedMs < 5_000, `expected the gate to fail well under 5s, took ${elapsedMs}ms`);
  } finally {
    server.close();
  }
});

test("task 2.5: the gate still passes within timeout-ms against a responsive platform", async () => {
  const server = await startMockApi();
  const { port } = server.address();

  try {
    const { outputs, failed } = await runAction({
      flag: "deploys-enabled",
      "base-url": `http://127.0.0.1:${port}`,
      credential: "test-credential",
      "timeout-ms": "2000",
    });

    assert.equal(failed, false);
    assert.equal(outputs.passed, "true");
  } finally {
    server.close();
  }
});
