// A minimal stand-in for the real rollfuse platform API, used only by
// this repo's own CI (.github/workflows/self-test.yml) to exercise the
// packaged action end to end without a rollfuse account — the same
// self-contained principle every example repo in this org follows. Not
// part of the packaged action itself (not referenced by action.yml or
// dist/index.js).
import { createServer } from "node:http";

const port = process.env.PORT ?? 8090;

const config = {
  environment_id: "env_ci",
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
  ],
};

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/config") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(config));
    return;
  }

  if (req.method === "POST" && req.url === "/v1/exposure-events") {
    res.writeHead(202);
    res.end(JSON.stringify({ accepted: 1 }));
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`mock-rollfuse-api: listening on :${port}`);
});
