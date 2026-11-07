import { isDeepStrictEqual } from "node:util";
import { evaluateAssertions, parseJsonObject, type Assertion, type AssertionReport } from "./assertions.ts";

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
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const parsed = parseJsonObject(trimmed);
  let object: unknown;

  // Parse the entire brace span so a valid first fenced object cannot hide another one.
  // The evaluator's interpretation must also agree, which excludes fenced and bare arrays.
  if (parsed.ok && start >= 0 && end > start &&
      !trimmed.slice(0, start).trimEnd().endsWith("[") && !trimmed.slice(end + 1).trimStart().startsWith("]")) {
    try {
      const candidate: unknown = JSON.parse(trimmed.slice(start, end + 1));
      if (isDeepStrictEqual(candidate, parsed.value)) object = candidate;
    } catch {
      // No single complete JSON object spans the delivery.
    }
  }

  const formatPassed = object !== undefined && start === 0 && end === trimmed.length - 1;
  let contentIssue: PositiveDeliveryResult["contentIssue"] = null;
  if (object === undefined) contentIssue = "not_unique_json_object";
  else if (hasDuplicateObjectKeys(trimmed.slice(start, end + 1))) contentIssue = "duplicate_json_key";
  else if (!isDeepStrictEqual(object, scriptResult)) contentIssue = "script_result_mismatch";
  else if (!report.allPassed) contentIssue = "frozen_assertions_failed";

  return { contentPassed: contentIssue === null, formatPassed, assertions: report, contentIssue };
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
