// tests/unit/authEnterSubmit.test.js
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const authPath = path.resolve(here, "../../src/pages/Auth.jsx");
const source = fs.readFileSync(authPath, "utf8");

describe("Auth Enter-to-submit wiring", () => {
  it("uses a form submit handler that prevents default browser navigation", () => {
    expect(source).toContain("<form onSubmit={submitAuth}>");
    expect(source).toContain("event.preventDefault();");
  });

  it("routes form submit to sign in, sign up, or reset based on mode", () => {
    expect(source).toMatch(/mode === "signin"[\s\S]*await signIn\(\)/);
    expect(source).toMatch(/mode === "signup"[\s\S]*await signUp\(\)/);
    expect(source).toContain("await reset();");
  });

  it("keeps only primary actions as submit buttons", () => {
    expect(source).toContain('type="submit"');
    expect(source).toContain('type="button"');
    expect(source).not.toContain("onClick={signIn}");
    expect(source).not.toContain("onClick={signUp}");
    expect(source).not.toContain("onClick={reset}");
  });
});
