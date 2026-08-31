import { describe, expect, test } from "bun:test";
import type { IAIProvider } from "../../src/interfaces/providers/ai.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import {
  GeminiDashboardPrecheckProvider,
  normalizePrecheckResult,
  stripJsonFences,
} from "../../src/providers/gemini-dashboard-precheck.provider";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

function providerReturning(raw: string | Error): {
  provider: GeminiDashboardPrecheckProvider;
  prompts: { userPrompt: string; systemInstruction?: string }[];
} {
  const prompts: { userPrompt: string; systemInstruction?: string }[] = [];
  const ai: Partial<IAIProvider> = {
    analyzeImage: async (_b64, _mime, prompt, systemInstruction) => {
      prompts.push({ userPrompt: prompt, systemInstruction });
      if (raw instanceof Error) throw raw;
      return raw;
    },
  };
  return {
    provider: new GeminiDashboardPrecheckProvider(
      ai as IAIProvider,
      mockLogger,
    ),
    prompts,
  };
}

const GOOD_RESPONSE = JSON.stringify({
  dashboardLit: true,
  odometer: { readable: true, valueKm: 45230, reasonCode: "OK" },
  fuel: {
    gaugeFound: true,
    readable: true,
    gaugeType: "ANALOG_NEEDLE",
    valuePct: 65,
    reasonCode: "OK",
  },
});

const PHOTO = { photo: Buffer.from("bytes"), mimeType: "image/jpeg" };

describe("stripJsonFences", () => {
  test("removes markdown fences the model adds despite instructions", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("normalizePrecheckResult", () => {
  test("passes a well-formed response through unchanged", () => {
    const result = normalizePrecheckResult(JSON.parse(GOOD_RESPONSE));

    expect(result.odometer).toEqual({
      readable: true,
      valueKm: 45230,
      reasonCode: "OK",
    });
    expect(result.fuel.readable).toBe(true);
    expect(result.fuel.valuePct).toBe(65);
    expect(result.fuel.gaugeType).toBe("ANALOG_NEEDLE");
  });

  test("demotes readable:true with no value to unreadable", () => {
    // A green tick next to a blank number reads to the driver as
    // "confirmed" — the exact false reassurance this feature removes.
    const result = normalizePrecheckResult({
      dashboardLit: true,
      odometer: { readable: true, valueKm: null, reasonCode: "OK" },
      fuel: {
        gaugeFound: true,
        readable: true,
        valuePct: null,
        gaugeType: "DIGITAL_BAR",
        reasonCode: "OK",
      },
    });

    expect(result.odometer.readable).toBe(false);
    expect(result.odometer.valueKm).toBeNull();
    expect(result.fuel.readable).toBe(false);
    expect(result.fuel.valuePct).toBeNull();
  });

  test("rejects a fuel percentage outside 0-100", () => {
    for (const valuePct of [-5, 140]) {
      const result = normalizePrecheckResult({
        fuel: {
          gaugeFound: true,
          readable: true,
          valuePct,
          gaugeType: "ANALOG_NEEDLE",
          reasonCode: "OK",
        },
      });
      expect(result.fuel.readable).toBe(false);
      expect(result.fuel.valuePct).toBeNull();
    }
  });

  test("drops a string odometer rather than guessing its separators", () => {
    // "45.230" is 45230 in id-ID and 45.23 in en-US. Unresolvable, so it
    // must not become a number the driver is shown as confirmed.
    const result = normalizePrecheckResult({
      odometer: { readable: true, valueKm: "45.230", reasonCode: "OK" },
    });

    expect(result.odometer.readable).toBe(false);
    expect(result.odometer.valueKm).toBeNull();
  });

  test("falls back to a safe reason code when the model invents one", () => {
    const result = normalizePrecheckResult({
      odometer: { readable: false, valueKm: null, reasonCode: "WEIRD_CODE" },
      fuel: {
        gaugeFound: false,
        readable: false,
        valuePct: null,
        gaugeType: "SOMETHING_ELSE",
        reasonCode: "ALSO_WEIRD",
      },
    });

    expect(result.odometer.reasonCode).toBe("NOT_IN_FRAME");
    expect(result.fuel.reasonCode).toBe("GAUGE_NOT_IN_FRAME");
    expect(result.fuel.gaugeType).toBe("NONE");
  });

  test("forces reasonCode to OK whenever a value was actually read", () => {
    const result = normalizePrecheckResult({
      odometer: { readable: true, valueKm: 100, reasonCode: "BLURRY" },
      fuel: {
        gaugeFound: true,
        readable: true,
        valuePct: 50,
        gaugeType: "DIGITAL_BAR",
        reasonCode: "GLARE",
      },
    });

    expect(result.odometer.reasonCode).toBe("OK");
    expect(result.fuel.reasonCode).toBe("OK");
  });

  test("survives a completely malformed payload", () => {
    for (const payload of [null, "nope", 42, [], {}]) {
      const result = normalizePrecheckResult(payload);
      expect(result.odometer.readable).toBe(false);
      expect(result.fuel.readable).toBe(false);
      expect(result.dashboardLit).toBe(false);
    }
  });
});

describe("GeminiDashboardPrecheckProvider.check", () => {
  test("returns CHECKED with the parsed result", async () => {
    const { provider, prompts } = providerReturning(GOOD_RESPONSE);
    const outcome = await provider.check(PHOTO);

    expect(outcome.status).toBe("CHECKED");
    if (outcome.status !== "CHECKED") throw new Error("unreachable");
    expect(outcome.result.odometer.valueKm).toBe(45230);
    expect(outcome.result.fuel.valuePct).toBe(65);
    // Rules belong in the system instruction, per the prompt-split contract.
    expect(prompts[0].systemInstruction).toContain("CRITICAL FUEL-GAUGE LOCK");
  });

  test("parses a fenced response", async () => {
    const { provider } = providerReturning(
      `\`\`\`json\n${GOOD_RESPONSE}\n\`\`\``,
    );
    const outcome = await provider.check(PHOTO);

    expect(outcome.status).toBe("CHECKED");
  });

  test("returns UNAVAILABLE when the AI call throws", async () => {
    const { provider } = providerReturning(new Error("503 upstream"));
    const outcome = await provider.check(PHOTO);

    expect(outcome.status).toBe("UNAVAILABLE");
  });

  test("returns UNAVAILABLE on an unparsable response", async () => {
    const { provider } = providerReturning("I could not analyze that photo.");
    const outcome = await provider.check(PHOTO);

    expect(outcome.status).toBe("UNAVAILABLE");
  });
});
