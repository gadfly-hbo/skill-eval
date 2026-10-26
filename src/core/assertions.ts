/**
 * 规则断言判定。
 *
 * 规则断言是客观、可复算的判据，优先级高于模型评委。
 * 断言必须在观察结果**之前**冻结——套件定义写死，不因运行结果调整。
 */

export interface MustMatchAssertion {
  kind: "mustMatch";
  pattern: string;
  flags?: string;
  /** 说明该断言意图，便于报告解读。 */
  note?: string;
}

export interface MustNotMatchAssertion {
  kind: "mustNotMatch";
  pattern: string;
  flags?: string;
  note?: string;
}

export interface MustContainAssertion {
  kind: "mustContain";
  value: string;
  note?: string;
}

export interface MustNotContainAssertion {
  kind: "mustNotContain";
  value: string;
  note?: string;
}

export interface JsonSchemaAssertion {
  kind: "jsonSchema";
  /** 顶层 schema，用于校验输出解析后的 JSON。 */
  schema: Record<string, unknown>;
  note?: string;
}

export interface NumericAssertion {
  kind: "numeric";
  /** 输出中提取该数值的正则，须含一个捕获组。 */
  pattern: string;
  /** 期望值。 */
  expected: number;
  /** 绝对容差。默认 0。 */
  tolerance?: number;
  note?: string;
}

export type Assertion =
  | MustMatchAssertion
  | MustNotMatchAssertion
  | MustContainAssertion
  | MustNotContainAssertion
  | JsonSchemaAssertion
  | NumericAssertion;

export interface AssertionOutcome {
  kind: Assertion["kind"];
  passed: boolean;
  /** 失败原因（人类可读）。 */
  detail: string;
  note?: string | undefined;
}

export interface AssertionReport {
  total: number;
  passed: number;
  failed: number;
  /** 全部通过为 true。 */
  allPassed: boolean;
  outcomes: AssertionOutcome[];
}

/**
 * 对一份输出执行全部断言。
 *
 * 断言失败不抛异常——失败是评估结果的一部分，必须完整保留。
 */
export function evaluateAssertions(output: string, assertions: Assertion[]): AssertionReport {
  const outcomes = assertions.map((assertion) => evaluateAssertion(output, assertion));
  const passed = outcomes.filter((outcome) => outcome.passed).length;

  return {
    total: outcomes.length,
    passed,
    failed: outcomes.length - passed,
    allPassed: outcomes.length > 0 && passed === outcomes.length,
    outcomes,
  };
}

export function evaluateAssertion(output: string, assertion: Assertion): AssertionOutcome {
  const note = assertion.note;

  switch (assertion.kind) {
    case "mustMatch": {
      const regex = safeRegExp(assertion.pattern, assertion.flags);
      if (!regex) {
        return { kind: assertion.kind, passed: false, detail: `无效正则: ${assertion.pattern}`, note };
      }
      const matched = regex.test(output);
      return {
        kind: assertion.kind,
        passed: matched,
        detail: matched ? `匹配到 ${assertion.pattern}` : `未匹配到 ${assertion.pattern}`,
        note,
      };
    }

    case "mustNotMatch": {
      const regex = safeRegExp(assertion.pattern, assertion.flags);
      if (!regex) {
        return { kind: assertion.kind, passed: false, detail: `无效正则: ${assertion.pattern}`, note };
      }
      const matched = regex.test(output);
      return {
        kind: assertion.kind,
        passed: !matched,
        detail: matched ? `不应出现的模式出现了: ${assertion.pattern}` : `成功避开 ${assertion.pattern}`,
        note,
      };
    }

    case "mustContain": {
      const passed = output.includes(assertion.value);
      return {
        kind: assertion.kind,
        passed,
        detail: passed ? `包含「${assertion.value}」` : `缺少「${assertion.value}」`,
        note,
      };
    }

    case "mustNotContain": {
      const passed = !output.includes(assertion.value);
      return {
        kind: assertion.kind,
        passed,
        detail: passed ? `成功避开「${assertion.value}」` : `出现了禁止内容「${assertion.value}」`,
        note,
      };
    }

    case "jsonSchema": {
      const parsed = parseJsonObject(output);
      if (!parsed.ok) {
        return { kind: assertion.kind, passed: false, detail: `输出不是合法 JSON：${parsed.detail}`, note };
      }
      const errors = validateJsonSchema(parsed.value, assertion.schema, "$");
      return {
        kind: assertion.kind,
        passed: errors.length === 0,
        detail: errors.length === 0 ? "符合 JSON Schema" : `违反 Schema：${errors.slice(0, 3).join("; ")}`,
        note,
      };
    }

    case "numeric": {
      const regex = safeRegExp(assertion.pattern);
      if (!regex) {
        return { kind: assertion.kind, passed: false, detail: `无效正则: ${assertion.pattern}`, note };
      }
      const match = regex.exec(output);
      if (!match) {
        return { kind: assertion.kind, passed: false, detail: `未提取到数值：${assertion.pattern}`, note };
      }
      const actual = Number(match[1]);
      if (!Number.isFinite(actual)) {
        return { kind: assertion.kind, passed: false, detail: `提取到的不是有效数值: ${match[1]}`, note };
      }
      const tolerance = assertion.tolerance ?? 0;
      const passed = Math.abs(actual - assertion.expected) <= tolerance;
      return {
        kind: assertion.kind,
        passed,
        detail: passed
          ? `数值 ${actual} 在期望 ${assertion.expected} ±${tolerance} 内`
          : `数值 ${actual} 超出期望 ${assertion.expected} ±${tolerance}`,
        note,
      };
    }

    default: {
      const unknown = assertion as { kind?: string };
      return { kind: (unknown.kind ?? "unknown") as Assertion["kind"], passed: false, detail: "未知断言类型", note };
    }
  }
}

function safeRegExp(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags ?? "");
  } catch {
    return null;
  }
}

/**
 * 从可能带 markdown 代码块或前后缀说明的文本中提取 JSON 对象。
 */
export function parseJsonObject(text: string): { ok: true; value: unknown } | { ok: false; detail: string } {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(trimmed);

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      continue;
    }
  }
  return { ok: false, detail: "无法解析为 JSON" };
}

/**
 * 轻量 JSON Schema 校验。
 *
 * 只支持评估场景实际会用到的关键字，避免引入 ajv 依赖：
 * type / required / properties / enum / minimum / maximum / minLength / maxLength / items。
 */
export function validateJsonSchema(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];

  const type = schema.type;
  if (typeof type === "string") {
    if (!matchesType(value, type)) {
      errors.push(`${path} 期望类型 ${type}，实际 ${describeType(value)}`);
      return errors;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`${path} 不在允许取值 ${JSON.stringify(schema.enum)} 中`);
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} 小于最小值 ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path} 大于最大值 ${schema.maximum}`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path} 短于最小长度 ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path} 长于最大长度 ${schema.maxLength}`);
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in record)) errors.push(`${path}.${key} 缺失必填字段`);
    }
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in record) {
        errors.push(...validateJsonSchema(record[key], subSchema, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value)) {
    const items = schema.items;
    if (items && typeof items === "object") {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(item, items as Record<string, unknown>, `${path}[${index}]`));
      });
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} 元素少于 ${schema.minItems} 个`);
    }
  }

  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
