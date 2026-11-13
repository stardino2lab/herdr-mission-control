import test from "node:test";
import assert from "node:assert/strict";
import { attempt, RateLimit, Tracker } from "../mods/mission-control/auto.js";

const screen = (command) => `
────────────────────────────────────────
 Bash command

   ${command}
   Does a thing

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again
   3. No, and tell Claude what to do differently (esc)
`;

// Screens are served in order; the last one repeats.
function io(screens, extra = {}) {
  const pressed = [];
  let n = 0;
  return {
    pressed,
    read: async () => {
      const s = screens[Math.min(n++, screens.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
    press: async (address, app) => {
      pressed.push([address, app]);
      return { ok: true, message: "" };
    },
    asks: () => true,
    limit: new RateLimit(10, 60000),
    now: () => 1000,
    ...extra,
  };
}

test("a safe command is approved after two matching reads", async () => {
  const x = io([screen("git status")]);
  const r = await attempt("t3", "claude-code", x);
  assert.equal(r.action, "approved");
  assert.deepEqual(x.pressed, [["t3", "claude-code"]]);
});

test("a dangerous command is held and no key is sent", async () => {
  const x = io([screen("rm -rf build")]);
  const r = await attempt("t3", "claude-code", x);
  assert.equal(r.action, "held");
  assert.equal(r.reason, "rule");
  assert.equal(r.rule, "rm-flags");
  assert.match(r.command, /rm -rf build/);
  assert.deepEqual(x.pressed, []);
});

test("the dialog changing between the reads is held", async () => {
  // Safe when judged, dangerous by the time the key would land.
  const x = io([screen("git status"), screen("rm -rf build")]);
  const r = await attempt("t3", "claude-code", x);
  assert.equal(r.action, "held");
  assert.equal(r.reason, "changed");
  assert.deepEqual(x.pressed, []);
});

test("the dialog gone by the second read is held", async () => {
  const x = io([screen("git status"), "● Done.\n> "]);
  assert.equal((await attempt("t3", "claude-code", x)).reason, "changed");
  assert.deepEqual(x.pressed, []);
});

test("an agent that stopped waiting is not sent a key", async () => {
  const x = io([screen("git status")], { asks: () => false });
  assert.equal((await attempt("t3", "claude-code", x)).reason, "not-blocked");
  assert.deepEqual(x.pressed, []);
});

test("a screen that can't be read is held", async () => {
  const x = io([new Error("unreachable")]);
  assert.equal((await attempt("vps/t3", "claude-code", x)).reason, "read-failed");
  const y = io([screen("git status"), new Error("unreachable")]);
  assert.equal((await attempt("vps/t3", "claude-code", y)).reason, "read-failed");
  assert.deepEqual(y.pressed, []);
});

test("an unknown agent and a screen without a dialog are held", async () => {
  assert.equal((await attempt("t3", "agy", io([screen("git status")]))).reason, "unknown-app");
  assert.equal((await attempt("t3", "claude-code", io(["just output\n"]))).reason, "no-dialog");
});

test("a failed key press is reported, not counted as approved", async () => {
  const x = io([screen("git status")], { press: async () => ({ ok: false, message: "no terminal" }) });
  const r = await attempt("t3", "claude-code", x);
  assert.equal(r.action, "failed");
  assert.equal(r.reason, "no terminal");
  const y = io([screen("git status")], { press: async () => { throw new Error("boom"); } });
  assert.equal((await attempt("t3", "claude-code", y)).action, "failed");
});

test("the rate limit holds the approval over the limit", async () => {
  const limit = new RateLimit(2, 60000);
  const x = io([screen("git status")], { limit });
  assert.equal((await attempt("t1", "claude-code", x)).action, "approved");
  assert.equal((await attempt("t2", "claude-code", x)).action, "approved");
  const third = await attempt("t3", "claude-code", x);
  assert.equal(third.action, "held");
  assert.equal(third.reason, "rate");
  assert.equal(x.pressed.length, 2);
});

test("RateLimit frees up as time passes", () => {
  const limit = new RateLimit(1, 1000);
  assert.equal(limit.open(0), true);
  limit.count(0);
  assert.equal(limit.open(500), false);
  assert.equal(limit.open(1000), true);
});

test("a held attempt does not use up the rate limit", async () => {
  const limit = new RateLimit(1, 60000);
  await attempt("t1", "claude-code", io([screen("sudo ls")], { limit }));
  assert.equal(limit.open(1000), true);
});

test("Tracker: look once, then only every recheck interval", () => {
  const t = new Tracker(10000);
  assert.equal(t.due("t1", 0), true);
  t.start("t1");
  assert.equal(t.due("t1", 1), false); // running
  t.finish("t1", 100, { action: "held", signature: "a" });
  assert.equal(t.due("t1", 5000), false);
  assert.equal(t.due("t1", 10100), true);
});

test("Tracker: a held dialog is announced once, a new one again", () => {
  const t = new Tracker();
  assert.equal(t.finish("t1", 0, { action: "held", signature: "a" }), "held");
  assert.equal(t.finish("t1", 10000, { action: "held", signature: "a" }), null);
  assert.equal(t.finish("t1", 20000, { action: "held", signature: "b" }), "held");
  assert.equal(t.finish("t1", 30000, { action: "approved", signature: "c" }), "approved");
});

test("Tracker: forgets terminals that stopped waiting", () => {
  const t = new Tracker();
  t.finish("t1", 0, { action: "held", signature: "a" });
  t.finish("t2", 0, { action: "approved", signature: "b" });
  t.prune(["t2"]);
  assert.equal(t.due("t1", 1), true);
  assert.equal(t.due("t2", 1), false);
  assert.equal(t.stuck("t2", "b"), true);
  t.prune([]);
  assert.equal(t.stuck("t2", "b"), false);
});

test("a dialog still there after its approval is not approved twice", async () => {
  const t = new Tracker(0);
  const x = io([screen("git status")], { stuck: (a, s) => t.stuck(a, s) });
  const first = await attempt("t1", "claude-code", x);
  assert.equal(t.finish("t1", 0, first), "approved");
  const second = await attempt("t1", "claude-code", x);
  assert.equal(second.action, "held");
  assert.equal(second.reason, "no-effect");
  assert.equal(t.finish("t1", 1, second), "held");
  const third = await attempt("t1", "claude-code", x);
  assert.equal(third.reason, "no-effect");
  assert.equal(t.finish("t1", 2, third), null);
  assert.equal(x.pressed.length, 1);
});
