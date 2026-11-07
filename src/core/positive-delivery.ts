import { isDeepStrictEqual } from "node:util";
import { evaluateAssertions, type Assertion, type AssertionReport } from "./assertions.ts";

export interface PositiveDeliveryResult {
  contentPassed: boolean;
  formatPassed: boolean;
  assertions: AssertionReport;
  contentIssue: "not_unique_json_object" | "duplicate_json_key" | "script_result_mismatch" | "frozen_assertions_failed" | null;
}

/** Compare the original response with the independently verified script result. */
export function evaluatePositiveDelivery(
  output: string,
  scriptResult: unknown,
  assertions: Assertion[],
): PositiveDeliveryResult {
  const report = evaluateAssertions(output, assertions);
  const trimmed = output.trim();
  const objects = readDeliveryObjects(trimmed);
  const formatPassed = objects?.length === 1 && objects[0]?.source === trimmed;
  let contentIssue: PositiveDeliveryResult["contentIssue"] = null;
  if (!objects?.length) contentIssue = "not_unique_json_object";
  else if (objects.some(({ source }) => hasDuplicateObjectKeys(source))) contentIssue = "duplicate_json_key";
  else if (objects.some(({ value }) => !isDeepStrictEqual(value, scriptResult))) contentIssue = "script_result_mismatch";
  else if (!report.allPassed) contentIssue = "frozen_assertions_failed";

  return { contentPassed: contentIssue === null, formatPassed, assertions: report, contentIssue };
}

/** Read every independent JSON object without mistaking braces inside strings for boundaries. */
function readDeliveryObjects(text: string): Array<{ source: string; value: unknown }> | null {
  const objects: Array<{ source: string; value: unknown }> = [];
  let start = 0;
  let depth = 0;
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index++;
      else if (char === '"') quoted = false;
    } else if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth++;
    } else if (depth > 0 && char === '"') {
      quoted = true;
    } else if (char === "}" || (depth > 0 && char === "]")) {
      if (--depth < 0) return null;
      if (depth > 0) continue;

      const source = text.slice(start, index + 1);
      try {
        const value: unknown = JSON.parse(source);
        if (Array.isArray(value)) return null;
        objects.push({ source, value });
      } catch {
        // Bracketed prose and Markdown links are wrappers, while JSON-like arrays are deliveries.
        if (source.startsWith("{") || /[{}]/.test(source) ||
            /^\[\s*(?:[\["\d-]|true\b|false\b|null\b)/.test(source)) return null;
      }
    }
  }
  return depth === 0 ? objects : null;
}

/** Scan an already parsed object so JSON.parse cannot hide a conflicting key. */
function hasDuplicateObjectKeys(json: string): boolean {
  const objects: Set<string>[] = [];
  for (const [token, key, colon] of json.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}]/g)) {
    if (token === "{") {
      objects.push(new Set());
    } else if (token === "}") {
      objects.pop();
    } else if (key !== undefined && colon !== undefined) {
      const decoded: string = JSON.parse(key);
      const keys = objects.at(-1)!;
      if (keys.has(decoded)) return true;
      keys.add(decoded);
    }
  }
  return false;
}
