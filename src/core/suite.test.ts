import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSuite, hashSuite, loadSuite, type SuiteFile } from "./suite.ts";

test("hashSuite 对判据变更敏感、对描述性元信息不敏感", () => {
  const base: SuiteFile = {
    id: "demo",
    version: "1.0",
    name: "演示套件",
    tasks: [
      {
        id: "t1",
        prompt: "请分析销售下降原因",
        assertions: [{ kind: "mustMatch", pattern: "样本量" }],
      },
    ],
  };

  const metadataChanged: SuiteFile = {
    ...base,
    name: "改个显示名称",
    version: "1.1",
  };
  assert.equal(hashSuite(base), hashSuite(metadataChanged));

  const assertionChanged: SuiteFile = {
    ...base,
    tasks: [
      {
        id: "t1",
        prompt: "请分析销售下降原因",
        assertions: [{ kind: "mustMatch", pattern: "样本量|N=" }],
      },
    ],
  };
  assert.notEqual(hashSuite(base), hashSuite(assertionChanged));
  assert.match(hashSuite(base), /^sha256:[0-9a-f]{16}$/);
});

test("checkSuite 拦截非法正则与无捕获组的 numeric 断言（errors）", () => {
  const suite: SuiteFile = {
    id: "bad-suite",
    tasks: [
      {
        id: "t1",
        prompt: "计算结果",
        assertions: [
          { kind: "mustMatch", pattern: "[unclosed" },
          { kind: "numeric", pattern: "结果是\\s*\\d+", expected: 42 },
        ],
      },
    ],
  };

  const res = checkSuite(suite);
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 2);
  assert.ok(res.errors.some((e) => e.includes("无效正则")));
  assert.ok(res.errors.some((e) => e.includes("捕获组")));
});

test("checkSuite 提示恒真正则、缺少负向断言、repeat<3 与缺少误触发测试（warnings）", () => {
  const suite: SuiteFile = {
    id: "warn-suite",
    repeat: 2,
    tasks: [
      {
        id: "t1",
        prompt: "分析数据",
        assertions: [{ kind: "mustMatch", pattern: ".*" }],
      },
    ],
  };

  const res = checkSuite(suite);
  assert.equal(res.valid, true);
  assert.ok(res.warnings.some((w) => w.includes("空字符串") || w.includes("恒真")));
  assert.ok(res.warnings.some((w) => w.includes("负向")));
  assert.ok(res.warnings.some((w) => w.includes("repeat=2")));
  assert.ok(res.warnings.some((w) => w.includes("shouldActivate")));
});

test("loadSuite 校验必填字段与重复 task.id", () => {
  const dir = mkdtempSync(join(tmpdir(), "suite-test-"));
  try {
    const filePath = join(dir, "dup.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        id: "dup",
        tasks: [
          { id: "a", prompt: "p1" },
          { id: "a", prompt: "p2" },
        ],
      }),
      "utf8",
    );
    assert.throws(() => loadSuite(filePath), /重复/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
