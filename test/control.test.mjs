import test from "node:test";
import assert from "node:assert/strict";
import { keysFor, approveArgs, denyArgs, sendArgs, cleanPrompt, canSend, outcome, pickTarget } from "../mods/mission-control/control.js";

test("approve and deny press the agent's keys, unknown apps use the default", () => {
  assert.deepEqual(approveArgs("t3", "claude-code"), ["keys", "--", "t3", "enter"]);
  assert.deepEqual(denyArgs("vps/t7", "something-new"), ["keys", "--", "vps/t7", "esc"]);
  assert.deepEqual(keysFor(null), keysFor("default"));
});

test("a prompt that looks like a flag stays text", () => {
  const args = sendArgs("t3", "--force");
  assert.deepEqual(args, ["send", "--", "t3", "--force"]);
  assert.ok(args.indexOf("--") < args.indexOf("--force"));
});

test("cleanPrompt makes one plain line", () => {
  assert.equal(cleanPrompt("  fix the\r\nlogin\tbug  "), "fix the login bug");
  assert.equal(cleanPrompt("a\u001b[31mb\u0007c"), "a[31mbc");
  assert.equal(cleanPrompt("한글 프롬프트"), "한글 프롬프트");
  assert.equal(cleanPrompt(null), "");
  assert.equal(cleanPrompt(" \n "), "");
});

test("no typing into an approval dialog", () => {
  assert.equal(canSend("blocked"), false);
  assert.equal(canSend("idle"), true);
  assert.equal(canSend("working"), true);
});

test("outcome reads hc's result", () => {
  assert.deepEqual(outcome({ code: 0, stdout: "{}", stderr: "" }), { ok: true, message: "" });
  assert.deepEqual(outcome({ code: 1, stdout: "", stderr: "no terminal t9\nmore" }), { ok: false, message: "no terminal t9" });
  assert.deepEqual(outcome({ code: 2, stdout: "", stderr: "" }), { ok: false, message: "exit 2" });
  const json = '{"error":{"hint":"see `hc ls --all`","kind":"not_found","message":"no terminal \\"t9\\""}}';
  assert.deepEqual(outcome({ code: 1, stdout: json, stderr: "" }), { ok: false, message: 'no terminal "t9"' });
  assert.deepEqual(outcome({ code: 0, stdout: json, stderr: "" }), { ok: false, message: 'no terminal "t9"' });
  assert.deepEqual(outcome(undefined), { ok: false, message: "exit ?" });
});

test("pickTarget: picked, else focused, else first, else none", () => {
  const rows = [{ address: "t1" }, { address: "t2", focused: true }, { address: "t3" }];
  assert.equal(pickTarget(rows, "t3").address, "t3");
  assert.equal(pickTarget(rows, "gone").address, "t2");
  assert.equal(pickTarget([{ address: "t1" }], null).address, "t1");
  assert.equal(pickTarget([], "t1"), null);
});
