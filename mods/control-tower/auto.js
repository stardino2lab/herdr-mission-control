// Auto-approve: the steps around one approval, and the memory that keeps it from
// repeating itself. No herdr imports: reading the screen and pressing keys are
// handed in, so it runs under plain node for tests.

import { parseDialog } from "./detector.js";
import { judge } from "./safety.js";

/** At most `max` approvals in any `perMs` window, across all agents. */
export class RateLimit {
  constructor(max = 10, perMs = 60000) {
    this.max = max;
    this.perMs = perMs;
    this.times = [];
  }
  /** Whether one more fits now. Does not count it. */
  open(now) {
    this.times = this.times.filter((t) => now - t < this.perMs);
    return this.times.length < this.max;
  }
  count(now) {
    this.times.push(now);
  }
}

/**
 * One attempt at one terminal's dialog.
 *
 * Reads the screen and judges it; if that says approve, reads again and
 * approves only when the very same dialog is still there and the agent still
 * waits. Between the two reads the screen may have moved on to another
 * question, and the key must not answer that one.
 *
 * @param io { read(address): Promise<string>, press(address, app): Promise<{ok, message}>,
 *             asks(address): boolean | Promise<boolean>, limit: RateLimit, now(): number,
 *             stuck?(address, signature): boolean }
 * @returns {{ action: "approved" | "held" | "failed", reason: string, rule: string | null,
 *            signature: string | null, command: string | null }}
 */
export async function attempt(address, app, io) {
  const out = (action, reason, dialog, rule = null) => ({ action, reason, rule, signature: dialog?.signature ?? null, command: dialog?.command ?? null });

  let first;
  try {
    first = parseDialog(app, await io.read(address));
  } catch (e) {
    return out("held", "read-failed", null);
  }
  const verdict = judge(first);
  if (verdict.verdict !== "approve") return out("held", verdict.reason, first, verdict.rule);
  // Already approved once and still there: the key did nothing. Don't press again.
  if (io.stuck?.(address, first.signature)) return out("held", "no-effect", first);
  if (!io.limit.open(io.now())) return out("held", "rate", first);

  let again;
  try {
    again = parseDialog(app, await io.read(address));
  } catch (e) {
    return out("held", "read-failed", first);
  }
  if (!again.complete || again.signature !== first.signature) return out("held", "changed", first);
  // `asks` may answer at once or after asking again (a promise); anything but a
  // plain yes, an error included, holds.
  let asks = false;
  try {
    asks = (await io.asks(address)) === true;
  } catch (e) {}
  if (!asks) return out("held", "not-blocked", first);

  // Asked again here, with nothing awaited before the count: attempts for several
  // agents run side by side, and all of them saw room at the first check.
  if (!io.limit.open(io.now())) return out("held", "rate", first);
  io.limit.count(io.now());
  let pressed;
  try {
    pressed = await io.press(address, app);
  } catch (e) {
    pressed = { ok: false, message: String(e?.message ?? e) };
  }
  return pressed.ok ? out("approved", "ok", first) : out("failed", pressed.message || "failed", first);
}

/**
 * What has been done about each waiting terminal, so a held dialog isn't read
 * every tick and an approved one isn't approved twice.
 *
 * A terminal is looked at when it starts waiting, and again every `recheckMs`
 * while it keeps waiting (a new question may have replaced the old one without
 * the status ever changing). If the dialog that was approved is still there on
 * a later look, the key did nothing, and it is left to the person.
 */
export class Tracker {
  constructor(recheckMs = 10000) {
    this.recheckMs = recheckMs;
    this.seen = new Map(); // address -> { at, action, signature }
    this.pressed = new Map(); // address -> signature of the dialog a key was sent to
    this.running = new Set();
  }

  /** Drops what is known about terminals that no longer wait. */
  prune(waiting) {
    const live = new Set(waiting);
    for (const address of this.seen.keys()) if (!live.has(address)) this.seen.delete(address);
    for (const address of this.pressed.keys()) if (!live.has(address)) this.pressed.delete(address);
  }

  /** Whether to look at this terminal now. */
  due(address, now) {
    if (this.running.has(address)) return false;
    const s = this.seen.get(address);
    return !s || now - s.at >= this.recheckMs;
  }

  start(address) {
    this.running.add(address);
  }

  /** No attempt is running. */
  idle() {
    return this.running.size === 0;
  }

  /**
   * Records an attempt's result. Returns what to tell the person:
   * "approved", "held" (newly held, worth a notice), or null (nothing new).
   */
  finish(address, now, result) {
    this.running.delete(address);
    const before = this.seen.get(address);
    const { action, signature } = result;
    this.seen.set(address, { at: now, action, signature });
    if (action === "approved") {
      this.pressed.set(address, signature);
      return "approved";
    }
    // The same dialog, held the same way as last look: nothing new to say.
    const repeat = before && before.action !== "approved" && before.signature === signature;
    return repeat ? null : "held";
  }

  /** A key was already sent to this very dialog and it is still there. */
  stuck(address, signature) {
    return signature !== null && this.pressed.get(address) === signature;
  }

  clear() {
    this.seen.clear();
    this.pressed.clear();
  }
}
