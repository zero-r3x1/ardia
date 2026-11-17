import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, inspect } from "./preflight.mjs";
import { fileURLToPath } from "node:url";

const ready = { platform: "win32", node: "24.22.3", pnpm: "11.1.3", expectedPnpm: "11.1.3", vs: "E:\\VS", sdk: true, expectedSdk: "10.0.26100.0", dependencies: true, policy: "RemoteSigned", gh: true };

test("a complete Windows host passes", () => {
  assert.ok(evaluate(ready).every((check) => check.passed));
});

test("missing compiler, dependencies and blocked scripts are all reported", () => {
  const failed = evaluate({ ...ready, vs: "", dependencies: false, policy: "Restricted" }).filter((check) => !check.passed);
  assert.deepEqual(failed.map((check) => check.name), ["msvc", "dependencies", "powershell"]);
  assert.ok(failed.every((check) => check.remedy.length));
});

test("a mismatched package manager and unknown policy fail closed", () => {
  assert.deepEqual(evaluate({ ...ready, pnpm: "10.0.0", policy: "" }).filter((check) => !check.passed).map((check) => check.name), ["pnpm", "powershell"]);
});

test("a non-Windows host with old Node cannot build the native app", () => {
  assert.deepEqual(evaluate({ ...ready, platform: "linux", node: "22.0.0" }).filter((check) => !check.passed).map((check) => check.name), ["platform", "node"]);
});

test("policy inspection observes the host policy without overriding it", () => {
  for (const policy of ["Restricted", "AllSigned", "RemoteSigned"]) {
    let probed = false;
    const facts = inspect(fileURLToPath(new URL("../../", import.meta.url)), (command, args) => {
      if (command !== "pwsh.exe") return { status: 0, stdout: "available" };
      probed = true;
      assert.ok(!args.some((arg) => arg.toLowerCase() === "-executionpolicy"));
      assert.equal(args.at(-1), "Get-ExecutionPolicy");
      return { status: 0, stdout: policy };
    });
    assert.ok(probed);
    assert.equal(facts.policy, policy);
    assert.equal(evaluate({ ...ready, policy: facts.policy }).find((check) => check.name === "powershell").passed, policy === "RemoteSigned");
  }
});
