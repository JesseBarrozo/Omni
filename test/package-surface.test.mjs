import assert from "node:assert/strict";
import { test } from "node:test";

test("published Omni entry points do not expose the test mock harness", async () => {
  const [root, adapters] = await Promise.all([
    import("omni-core"),
    import("omni-core/adapters"),
  ]);
  assert.equal("MockHarnessAdapter" in root, false);
  assert.equal("MockHarnessAdapter" in adapters, false);
  assert.equal(typeof adapters.assertHarnessAdapter, "function");
});
