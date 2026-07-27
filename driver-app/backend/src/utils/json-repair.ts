import type { ILogger } from "../interfaces/providers/logger.provider.interface";

/**
 * Strips markdown code fences Gemini sometimes wraps JSON in, then parses.
 * If parsing fails, attempts one narrow repair: balance any unterminated
 * trailing brackets/braces and retry.
 *
 * This recovers a known Gemini/SDK quirk where a finishReason: STOP
 * response (i.e. NOT a genuine MAX_TOKENS/SAFETY truncation — callers must
 * have already checked that via gemini.provider.ts's assertFinishedNormally
 * before calling this) is still missing its final closing bracket(s). The
 * repair can only APPEND trailing closers, never rewrite or invent content,
 * so it cannot fabricate data: if the response is genuinely incomplete
 * (e.g. cut off mid-array-element or mid-string), the repaired string still
 * won't parse and the original error is rethrown unchanged.
 */
export function parseGeminiJson<T>(
  rawResponse: string,
  log: ILogger,
  context: Record<string, unknown>,
): T {
  const cleaned = rawResponse
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (originalError) {
    const repaired = closeUnbalancedJson(cleaned);
    if (repaired !== cleaned) {
      try {
        const parsed = JSON.parse(repaired) as T;
        log.warn(
          "Repaired truncated Gemini JSON response (missing trailing closers)",
          {
            ...context,
            originalLength: cleaned.length,
            addedChars: repaired.length - cleaned.length,
          },
        );
        return parsed;
      } catch {
        // Repair didn't produce valid JSON either — fall through to throw
        // the original error, which is the more useful diagnostic.
      }
    }
    throw originalError;
  }
}

/**
 * Appends whatever closing `}`/`]` characters are needed to balance a JSON
 * string, tracking string-literal state so brackets inside string values
 * aren't miscounted. Returns the input unchanged if it's already balanced,
 * or if a string literal is left unterminated — that shape means content is
 * missing mid-value, not just a trailing closer, and there's nothing safe
 * to append.
 */
function closeUnbalancedJson(text: string): string {
  const stack: Array<"}" | "]"> = [];
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }

  if (inString || stack.length === 0) return text;
  return text + stack.reverse().join("");
}
