import { describe, expect, test } from "bun:test";
import { parseGeminiJson } from "../../src/utils/json-repair";

function makeLogger() {
  const warnCalls: Array<{ message: string; meta?: Record<string, unknown> }> =
    [];
  return {
    warnCalls,
    logger: {
      info: () => {},
      warn: (message: string, meta?: Record<string, unknown>) => {
        warnCalls.push({ message, meta });
      },
      error: () => {},
      debug: () => {},
      child: () => makeLogger().logger,
    },
  };
}

describe("parseGeminiJson", () => {
  test("parses well-formed JSON without repair", () => {
    const { logger, warnCalls } = makeLogger();
    const result = parseGeminiJson<{ a: number }>('{"a": 1}', logger, {});
    expect(result).toEqual({ a: 1 });
    expect(warnCalls.length).toBe(0);
  });

  test("strips markdown code fences before parsing", () => {
    const { logger } = makeLogger();
    const result = parseGeminiJson<{ a: number }>(
      '```json\n{"a": 1}\n```',
      logger,
      {},
    );
    expect(result).toEqual({ a: 1 });
  });

  test("repairs a response missing only its final closing brace", () => {
    const { logger, warnCalls } = makeLogger();
    // The exact shape reported in production: every field present and
    // well-formed, including a properly-closed empty array, but the
    // response is missing its outer closing brace.
    const raw =
      '{ "licensePlate": "B 1261 SNQ", "make": "Wuling", "confidence": 0.95, "damages": []';
    const result = parseGeminiJson<Record<string, unknown>>(raw, logger, {
      stepId: "s1",
    });
    expect(result).toEqual({
      licensePlate: "B 1261 SNQ",
      make: "Wuling",
      confidence: 0.95,
      damages: [],
    });
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0].message).toContain(
      "Repaired truncated Gemini JSON response",
    );
    expect(warnCalls[0].meta).toMatchObject({ stepId: "s1", addedChars: 1 });
  });

  test("repairs multiple missing nested closers", () => {
    const { logger } = makeLogger();
    const raw = '{"a": 1, "b": [1, 2, {"c": 3';
    const result = parseGeminiJson<Record<string, unknown>>(raw, logger, {});
    expect(result).toEqual({ a: 1, b: [1, 2, { c: 3 }] });
  });

  test("does not repair a response truncated mid-string (unsafe to guess)", () => {
    const { logger, warnCalls } = makeLogger();
    const raw = '{"licensePlate": "B 1261 SN';
    expect(() => parseGeminiJson(raw, logger, {})).toThrow();
    expect(warnCalls.length).toBe(0);
  });

  test("rethrows the original error when the repair also fails to parse", () => {
    const { logger } = makeLogger();
    // Malformed in a way no bracket-balancing can fix (trailing comma).
    const raw = '{"a": 1,}';
    expect(() => parseGeminiJson(raw, logger, {})).toThrow(
      /Property name must be a string/,
    );
  });

  test("does not repair already-balanced-but-otherwise-invalid JSON", () => {
    const { logger } = makeLogger();
    const raw = "{not: valid}";
    expect(() => parseGeminiJson(raw, logger, {})).toThrow();
  });
});
