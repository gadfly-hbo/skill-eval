import { test } from "node:test";
import assert from "node:assert/strict";

import { toPendingJson, pickSoleSkill } from "./pending-json.ts";
import type { PendingState } from "./pending.ts";

function makeState(overrides: Partial<PendingState> = {}): PendingState {
  return {
    pendingRoot: "/repo/pending",
    exists: true,
    skills: [],
    ...overrides,
  };
}

test("JSON 视图带出 SKILL.md 的绝对路径", () => {
  const json = toPendingJson(
    makeState({
      skills: [{ name: "demo", meta: null }],
    }),
  );

  assert.equal(json.skills[0]?.skillPath, "/repo/pending/demo/SKILL.md");
});

test("JSON 视图保留来源与登记时间", () => {
  const json = toPendingJson(
    makeState({
      skills: [
        {
          name: "demo",
          meta: {
            skill: "demo",
            sourcePath: "~/skills/demo/SKILL.md",
            registeredAt: "2026-11-04T00:00:00.000Z",
          },
        },
      ],
    }),
  );

  assert.equal(json.skills[0]?.source, "~/skills/demo/SKILL.md");
  assert.equal(json.skills[0]?.registeredAt, "2026-11-04T00:00:00.000Z");
});

test("无登记信息时来源与时间为 null", () => {
  const json = toPendingJson(makeState({ skills: [{ name: "demo", meta: null }] }));

  assert.equal(json.skills[0]?.source, null);
  assert.equal(json.skills[0]?.registeredAt, null);
});

test("暂存区不存在时 exists 为 false", () => {
  const json = toPendingJson(makeState({ exists: false }));

  assert.equal(json.exists, false);
  assert.deepEqual(json.skills, []);
});

test("JSON 视图可被 JSON.stringify 序列化", () => {
  const json = toPendingJson(makeState({ skills: [{ name: "demo", meta: null }] }));
  const parsed = JSON.parse(JSON.stringify(json)) as typeof json;

  assert.equal(parsed.pendingRoot, "/repo/pending");
  assert.equal(parsed.skills[0]?.name, "demo");
});

test("只有一个 skill 时能直接挑出来", () => {
  const json = toPendingJson(
    makeState({ skills: [{ name: "solo", meta: null }, ] }),
  );

  const picked = pickSoleSkill(json);

  assert.ok(picked);
  assert.equal(picked.name, "solo");
  assert.equal(picked.skillPath, "/repo/pending/solo/SKILL.md");
});

test("多个 skill 时挑不出来——得问用户", () => {
  const json = toPendingJson(
    makeState({
      skills: [
        { name: "a", meta: null },
        { name: "b", meta: null },
      ],
    }),
  );

  assert.equal(pickSoleSkill(json), null);
});

test("没有 skill 时挑不出来", () => {
  const json = toPendingJson(makeState({ skills: [] }));
  assert.equal(pickSoleSkill(json), null);
});
