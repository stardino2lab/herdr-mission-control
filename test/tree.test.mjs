import test from "node:test";
import assert from "node:assert/strict";
import { buildGroups, subtree, subStatus, machineOf, totals } from "../mods/control-tower/tree.js";

const agent = (address, status, seq = 0) => ({ address, status, seq });
const term = (address, extra = {}) => ({ address, state: "live", ...extra });

test("machineOf splits a remote address", () => {
  assert.equal(machineOf("vps/t7"), "vps");
  assert.equal(machineOf("t7"), null);
});

test("groups: this computer first, then machines by name, empty machines kept", () => {
  const groups = buildGroups(
    [agent("zeta/t1", "working"), agent("t1", "idle")],
    [term("zeta/t1"), term("t1")],
    [{ name: null, layout: "ready" }, { name: "zeta", layout: "ready" }, { name: "alpha", layout: "unavailable" }],
  );
  assert.deepEqual(groups.map((g) => g.machine), [null, "alpha", "zeta"]);
  assert.equal(groups[1].layout, "unavailable");
  assert.equal(groups[1].agents.length, 0);
});

test("most urgent agent first; a parent takes its sub-agent's urgency", () => {
  const groups = buildGroups(
    [agent("t1", "working", 5), agent("t2", "idle", 9), agent("t3", "blocked", 1)],
    [term("t1"), term("t2"), term("t3"), term("t4", { parent: "t2", status: "error" })],
    [],
  );
  const order = groups[0].agents.map((x) => x.a.address);
  // t2 is idle itself but its sub-agent errored (= blocked) and it changed most recently.
  assert.deepEqual(order, ["t2", "t3", "t1"]);
  assert.equal(groups[0].counts.blocked, 2);
});

test("subtree is depth first with tree guides, and skips finished terminals", () => {
  const all = [
    term("t1"),
    term("t2", { parent: "t1" }),
    term("t3", { parent: "t2" }),
    term("t4", { parent: "t1" }),
    { address: "t5", parent: "t1", state: "finished" },
  ];
  const rows = subtree(all, "t1");
  assert.deepEqual(rows.map((r) => r.t.address), ["t2", "t3", "t4"]);
  assert.deepEqual(rows.map((r) => r.lines), [["├"], ["│", "└"], ["└"]]);
});

test("a remote child whose parent is written without the machine still nests", () => {
  const all = [term("vps/t1"), term("vps/t2", { parent: "t1" })];
  assert.deepEqual(subtree(all, "vps/t1").map((r) => r.t.address), ["vps/t2"]);
  // The same bare parent on this computer is a different terminal.
  assert.deepEqual(subtree(all, "t1"), []);
});

test("an agent that is a live sub-agent shows under its parent only", () => {
  const groups = buildGroups(
    [agent("t1", "working"), agent("t2", "working")],
    [term("t1"), term("t2", { parent: "t1" })],
    [],
  );
  assert.deepEqual(groups[0].agents.map((x) => x.a.address), ["t1"]);
  assert.deepEqual(groups[0].agents[0].subs.map((s) => s.t.address), ["t2"]);
  assert.equal(groups[0].counts.working, 2);
});

test("a parent cycle does not loop forever", () => {
  const all = [term("t1", { parent: "t2" }), term("t2", { parent: "t1" })];
  assert.equal(subtree(all, "t1").length, 1);
});

test("subStatus: error needs the person, done reads idle, unknown is null", () => {
  const listed = new Map([["t9", "working"]]);
  assert.equal(subStatus({ address: "t1", status: "error" }, listed), "blocked");
  assert.equal(subStatus({ address: "t1", status: "done" }, listed), "idle");
  assert.equal(subStatus({ address: "t9", status: "idle" }, listed), "working");
  assert.equal(subStatus({ address: "t1", status: "exited" }, listed), null);
  assert.equal(subStatus({ address: "t1" }, listed), null);
});

test("totals sum every group", () => {
  const groups = buildGroups(
    [agent("t1", "blocked"), agent("vps/t1", "blocked"), agent("vps/t2", "done")],
    [term("t1"), term("vps/t1"), term("vps/t2")],
    [],
  );
  assert.deepEqual(totals(groups), { blocked: 2, done: 1, working: 0, idle: 0 });
});
