// Pure data shaping: agents + terminals + machines -> groups of rows.
// No herdr or gpui imports, so it runs under plain node for tests.

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

/** "vps/t7" -> "vps"; "t7" -> null (this computer). */
export const machineOf = (address) => {
  const i = (address ?? "").indexOf("/");
  return i > 0 ? address.slice(0, i) : null;
};

// A parent may be written local to its machine ("t3") while the child's address
// carries the machine ("vps/t7"). Both spellings count as the same terminal.
function isChildOf(kid, address) {
  if (!kid.parent) return false;
  const m = machineOf(kid.address);
  const parent = m !== null && machineOf(kid.parent) === null ? `${m}/${kid.parent}` : kid.parent;
  return parent === address;
}

/** A sub-agent's status word. Errors need the person; a sub-agent is never
 *  "done" on its own (it reports to its parent). Unknown words give null. */
export function subStatus(kid, listed) {
  const s = listed.get(kid.address) ?? kid.status;
  if (s === "error") return "blocked";
  if (s === "done") return "idle";
  return s in RANK ? s : null;
}

/** Live sub-agents of `address`, depth first. `lines` are the tree guides in
 *  front of each: "├" / "└" for the row's own branch, "│" / "" for ancestors. */
export function subtree(all, address, lead = [], seen = new Set()) {
  if (seen.has(address)) return [];
  seen.add(address);
  const kids = all.filter((k) => k.state === "live" && !seen.has(k.address) && isChildOf(k, address));
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...lead, last ? "└" : "├"] },
      ...subtree(all, k.address, [...lead, last ? "" : "│"], seen),
    ];
  });
}

/**
 * Groups agents by machine, this computer first, then machines by name.
 * A machine with no agents still gets a group so its connection state shows.
 * Within a group the most urgent agent comes first (a parent takes its most
 * urgent sub-agent's urgency), then the most recently changed.
 *
 * @param list     agents()
 * @param all      terminals()
 * @param machines machines()
 */
export function buildGroups(list, all, machines) {
  const listed = new Map(list.map((a) => [a.address, a.status]));
  const live = all.filter((k) => k.state === "live");

  // An agent that is itself a live sub-agent shows under its parent only.
  const nested = new Set();
  for (const k of live) {
    if (k.parent && live.some((p) => isChildOf(k, p.address))) nested.add(k.address);
  }

  const groups = new Map();
  const group = (name, layout) => {
    if (!groups.has(name)) groups.set(name, { machine: name, layout: layout ?? "ready", agents: [], counts: { blocked: 0, done: 0, working: 0, idle: 0 } });
    else if (layout) groups.get(name).layout = layout;
    return groups.get(name);
  };

  group(null, "ready");
  for (const m of machines ?? []) group(m.name ?? null, m.layout);

  for (const a of list) {
    if (nested.has(a.address)) continue;
    const g = group(machineOf(a.address));
    // `asks`: it is waiting on an approval dialog (an errored sub-agent also needs
    // the person, but has no dialog to answer).
    const subs = subtree(all, a.address).map((s) => ({
      ...s,
      status: subStatus(s.t, listed),
      asks: (listed.get(s.t.address) ?? s.t.status) === "blocked",
    }));
    const urgency = Math.max(RANK[a.status] ?? 0, ...subs.map((s) => RANK[s.status] ?? 0));
    g.agents.push({ a, subs, urgency });
    if (a.status in g.counts) g.counts[a.status] += 1;
    for (const s of subs) if (s.status in g.counts) g.counts[s.status] += 1;
  }

  for (const g of groups.values()) g.agents.sort((x, y) => y.urgency - x.urgency || (y.a.seq ?? 0) - (x.a.seq ?? 0));

  return [...groups.values()].sort((x, y) => {
    if (x.machine === null) return -1;
    if (y.machine === null) return 1;
    return x.machine.localeCompare(y.machine);
  });
}

/** Totals over every group. */
export function totals(groups) {
  const sum = { blocked: 0, done: 0, working: 0, idle: 0 };
  for (const g of groups) for (const k of Object.keys(sum)) sum[k] += g.counts[k];
  return sum;
}
