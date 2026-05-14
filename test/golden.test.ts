import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { formatFile } from "../src/edit/runner.js";

const FIXTURES_ROOT = join(__dirname, "fixtures");

interface Fixture {
  name: string;
  inputPath: string;
  expectedPath: string;
}

function discoverFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const ruleDir of readdirSync(FIXTURES_ROOT)) {
    const ruleDirPath = join(FIXTURES_ROOT, ruleDir);
    if (!statSync(ruleDirPath).isDirectory()) continue;
    for (const caseDir of readdirSync(ruleDirPath)) {
      const caseDirPath = join(ruleDirPath, caseDir);
      if (!statSync(caseDirPath).isDirectory()) continue;
      const files = readdirSync(caseDirPath);
      const input = files.find((f) => f.startsWith("input."));
      const expected = files.find((f) => f.startsWith("expected."));
      if (!input || !expected) continue;
      fixtures.push({
        name: `${ruleDir}/${caseDir}`,
        inputPath: join(caseDirPath, input),
        expectedPath: join(caseDirPath, expected),
      });
    }
  }
  return fixtures;
}

describe("golden fixtures", () => {
  const fixtures = discoverFixtures();
  expect(fixtures.length).toBeGreaterThan(0);

  for (const fixture of fixtures) {
    it(`formats ${fixture.name}`, () => {
      const input = readFileSync(fixture.inputPath, "utf8");
      const expected = readFileSync(fixture.expectedPath, "utf8");
      const result = formatFile({
        filePath: fixture.inputPath,
        source: input,
        config: defaultConfig(),
      });
      expect(result.status).not.toBe("conflict");
      expect(result.status).not.toBe("parse-error");
      expect(result.output).toBe(expected);
    });

    it(`is idempotent for ${fixture.name}`, () => {
      const expected = readFileSync(fixture.expectedPath, "utf8");
      const result = formatFile({
        filePath: fixture.inputPath,
        source: expected,
        config: defaultConfig(),
      });
      expect(result.output).toBe(expected);
    });
  }
});
