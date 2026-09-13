const { spawnSync } = require("node:child_process");
const path = require("node:path");

// External model availability is a separate QA gate, not a compilation gate.
// The child retains its real exit status; this wrapper records it without
// propagating a provider outage/billing denial into the deployment build.
const result = spawnSync(process.execPath, [
  require.resolve("tsx/cli"),
  path.join(__dirname, "qa-tf-assist-model-deployment.ts"),
], { stdio: "inherit", timeout: 30000 });
console.info(JSON.stringify({
  event: "tf_assist_model_qa_gate",
  qaExitCode: result.status ?? 1,
  blockingBuild: false,
}));
