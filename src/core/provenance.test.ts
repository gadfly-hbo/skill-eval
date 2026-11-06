import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeSkill, identifySkill, assertSkillIdentity } from "./provenance.ts";

test("冻结整个 skill 包：辅助脚本变动改变身份，源文件后续变动不改变快照", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  mkdirSync(join(source, "scripts"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "# original");
  writeFileSync(join(source, "scripts", "calc.py"), "print(1)");
  const original = identifySkill(join(source, "SKILL.md"));
  const frozen = freezeSkill(join(source, "SKILL.md"), join(root, "frozen"));
  assert.equal(frozen.identity.hash, original.hash);
  writeFileSync(join(source, "scripts", "calc.py"), "print(2)");
  assert.notEqual(identifySkill(join(source, "SKILL.md")).hash, original.hash);
  assert.equal(identifySkill(frozen.skillPath).hash, original.hash);
  assert.equal(readFileSync(join(root, "frozen", "scripts", "calc.py"), "utf8"), "print(1)");
  assert.throws(() => assertSkillIdentity(join(source, "SKILL.md"), original), /身份|哈希/);
});

test("身份按内容绑定，搬迁可接受，未测候选与符号链接拒绝", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-identity-move-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["a", "b"]) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "SKILL.md"), "same");
  }
  const expected = identifySkill(join(root, "a", "SKILL.md"));
  assert.doesNotThrow(() => assertSkillIdentity(join(root, "b", "SKILL.md"), expected));
  writeFileSync(join(root, "b", "SKILL.md"), "Never evaluated");
  assert.throws(() => assertSkillIdentity(join(root, "b", "SKILL.md"), expected), /身份|哈希/);
  symlinkSync(join(root, "b", "SKILL.md"), join(root, "a", "leak.md"));
  assert.throws(() => identifySkill(join(root, "a", "SKILL.md")), /符号链接/);
});
