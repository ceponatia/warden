import { describe, expect, it } from "vitest";

import { ensureSlug } from "../mcp/tools.js";
import { TrajectoryStore } from "../work/trajectory-store.js";

describe("slug validation", () => {
  it("accepts known valid slugs", async () => {
    await expect(ensureSlug("chatterbox")).resolves.toBe("chatterbox");
  });

  it("rejects traversal attempts", async () => {
    await expect(ensureSlug("../../etc")).rejects.toThrow("Invalid repo slug");
    await expect(ensureSlug("../passwd")).rejects.toThrow("Invalid repo slug");
    await expect(ensureSlug("foo/bar")).rejects.toThrow("Invalid repo slug");
  });

  it("rejects empty or whitespace slugs", async () => {
    await expect(ensureSlug("")).rejects.toThrow("Missing repo slug");
    await expect(ensureSlug("  ")).rejects.toThrow("Missing repo slug");
    await expect(ensureSlug(undefined)).rejects.toThrow("Missing repo slug");
  });

  it("rejects special characters and unknown slugs", async () => {
    await expect(ensureSlug("foo bar")).rejects.toThrow("Invalid repo slug");
    await expect(ensureSlug("foo\u0000bar")).rejects.toThrow(
      "Invalid repo slug",
    );
    await expect(ensureSlug(".hidden")).rejects.toThrow("Invalid repo slug");
    await expect(ensureSlug("repo_2")).rejects.toThrow("Unknown repo slug");
  });
});

describe("trajectory store path containment", () => {
  it("rejects base directory traversal via slug", () => {
    expect(() => new TrajectoryStore("../../etc")).toThrow(
      "Trajectory path escapes data directory",
    );
  });
});
