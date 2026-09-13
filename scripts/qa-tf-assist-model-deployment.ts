import { deploymentModelSmoke } from "../lib/tf-assist/deployment-smoke";

deploymentModelSmoke(process.env)
  .then((result) => {
    console.info(JSON.stringify(result));
    if (result.status === "failed") process.exitCode = 1;
  })
  .catch(() => {
    // Never print raw provider errors, request objects or environment values.
    console.error(JSON.stringify({ event: "tf_assist_model_smoke", status: "failed", code: "UNEXPECTED" }));
    process.exitCode = 1;
  });
