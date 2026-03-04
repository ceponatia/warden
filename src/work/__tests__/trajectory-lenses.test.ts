import { describe, expect, it } from "vitest";

import {
  filterDiffByPolicy,
  redactSecretAssignments,
} from "../trajectory-lenses.js";

describe("trajectory lens diff filtering", () => {
  it("filters denylisted file hunks from diff payloads", () => {
    const rawDiff = `diff --git a/.env b/.env
index 111..222 100644
--- a/.env
+++ b/.env
@@ -1 +1 @@
-OLD=1
+API_KEY=abc123
diff --git a/src/app.ts b/src/app.ts
index 333..444 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-console.log("old");
+console.log("new");`;

    const filtered = filterDiffByPolicy(rawDiff, ["*.env"]);

    expect(filtered).toContain("[Content filtered by Warden diff policy]");
    expect(filtered).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(filtered).toContain('+console.log("new");');
    expect(filtered).not.toContain("API_KEY=abc123");
  });

  it("redacts secret assignment lines", () => {
    const rawDiff = `+API_KEY=sk-12345\n+PASSWORD: super-secret\n+const x = 1;`;

    const redacted = redactSecretAssignments(rawDiff);

    expect(redacted).toContain("+API_KEY= [REDACTED]");
    expect(redacted).toContain("+PASSWORD= [REDACTED]");
    expect(redacted).toContain("+const x = 1;");
  });
});
