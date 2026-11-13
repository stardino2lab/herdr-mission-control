import { test } from "node:test";
import assert from "node:assert/strict";
import { STR, LANGS, pickLang, nextLang, langLabel, hasLang } from "../mods/mission-control/strings.js";

test("strings: every language has every key, with something in it", () => {
  const keys = Object.keys(STR.en).sort();
  assert.deepEqual(Object.keys(STR).sort(), LANGS.map((l) => l.id).sort());
  for (const { id } of LANGS) {
    assert.deepEqual(Object.keys(STR[id]).sort(), keys, id);
    for (const key of keys) assert.ok(typeof STR[id][key] === "string" && STR[id][key].trim(), `${id}.${key}`);
  }
});

test("strings: key names and the answer the dialog shows stay as they are", () => {
  for (const { id } of LANGS) {
    assert.ok(STR[id].approve.includes("(Enter)"), id);
    assert.ok(STR[id].deny.includes("(Esc)"), id);
    assert.ok(STR[id]["r.not-default"].includes("Yes"), id);
  }
});

test("pickLang: the system locale's language when there is one, else English", () => {
  const cases = { "ko-KR": "ko", ko: "ko", "ja-JP": "ja", "zh-CN": "zh", "zh-Hant-TW": "zh", pt_BR: "pt", "es-419": "es", "de-AT": "de", "fr-CA": "fr", "en-GB": "en", "ru-RU": "en", "": "en", C: "en", "POSIX": "en" };
  for (const [locale, want] of Object.entries(cases)) assert.equal(pickLang(locale), want, locale);
  assert.equal(pickLang(null), "en");
  assert.equal(pickLang(undefined), "en");
});

test("nextLang: steps through every language once and comes back", () => {
  const seen = [];
  let id = "en";
  for (let i = 0; i < LANGS.length; i++) {
    seen.push(id);
    id = nextLang(id);
  }
  assert.equal(id, "en");
  assert.deepEqual(seen, LANGS.map((l) => l.id));
  assert.equal(nextLang("no-such"), "en");
});

test("language labels are short and all different", () => {
  const labels = LANGS.map((l) => l.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const label of labels) assert.ok([...label].length <= 2, label);
  assert.equal(langLabel("ja"), "日");
  assert.equal(langLabel("xx"), "EN");
  assert.equal(hasLang("toString"), false);
  assert.equal(hasLang("constructor"), false);
});
