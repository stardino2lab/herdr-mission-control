// Mission Control: every agent on every machine as a one-line tree, most urgent first.
// Status, sub-agents, jump, approve / deny, a one-line prompt, auto-approve, Korean/English.

import { View } from "gpui-kit";
import { v_flex, InputState } from "gpui-base";
import { agents, terminals, machines, spaces, run, hc, notify, theme } from "herdr";
import { buildGroups, totals } from "./tree.js";
import { approveArgs, denyArgs, sendArgs, readArgs, cleanPrompt, canSend, outcome, pickTarget } from "./control.js";
import { attempt, RateLimit, Tracker } from "./auto.js";
import { lang, upcomingLang, setLang, tr, trIn } from "./i18n.js";
import { LANGS } from "./strings.js";
import { topBar, groupHeader, agentRow, subRow, note, promptBar, logBar } from "./ui.js";

// Auto-approve is driven by Herdr's own changes, not by a clock: Herdr re-renders
// this mod when an agent starts or stops waiting, and render() starts the work.
// Nothing runs while it is off or nobody waits. The one timer is a single
// look-again, set only while a dialog is being held (a new question can replace
// the old one without the agent's status changing).
const RECHECK_MS = 10000;
// The screen only, no history. An agent's dialog is drawn on its screen, and a
// dialog too tall for it has no header in view, which is held. Asking hc 0.1.16
// for history of a full-screen program (`--lines N`) never returns.
const READ_LINES = 0;
const PER_MINUTE = 10;
const LOG_SIZE = 30;

// Whether this terminal waits on an approval dialog right now, read fresh:
// the list on screen may be a moment old when a button is pressed.
function asksNow(address) {
  const a = agents().find((x) => x.address === address);
  if (a) return a.status === "blocked";
  return terminals().find((x) => x.address === address)?.status === "blocked";
}

export default class MissionControl extends View {
  init(_props, cx) {
    // Off on every start, never saved: pressing keys by itself is opted into each time.
    this.auto = false;
    this.tracker = new Tracker(RECHECK_MS);
    this.recheck = false; // a look-again is set
    this.limit = new RateLimit(PER_MINUTE, 60000);
    this.log = []; // newest first: { at, address, action, reason, rule, command }
    this.logOpen = false;
    this.waiting = []; // rows waiting on a dialog, on machines that can be reached
    this.folded = new Set();
    this.busy = new Set(); // addresses with an action on its way
    this.picked = null; // the row the prompt goes to
    this.last = null; // { address, ok, key, detail }: what the last action did
    this.text = "";
    this.inputFocused = false;
    // A placeholder is fixed when its input is made, and an input can't be made while
    // drawing, so every language gets its own here.
    this.inputs = Object.fromEntries(LANGS.map((l) => [l.id, this.makeInput(l.id)]));
  }

  makeInput(language) {
    const input = InputState.new({ placeholder: trIn(language, "placeholder") });
    input.on("change", (_e, cx) => {
      this.text = input.value();
      cx.notify();
    });
    input.on("submit", (_e, cx) => this.send(cx));
    input.on("focus", (_e, cx) => {
      this.inputFocused = true;
      cx.notify();
    });
    input.on("blur", (_e, cx) => {
      this.inputFocused = false;
      cx.notify();
    });
    return input;
  }

  // Steps to the next language, carrying what was typed over to that language's input.
  switchLang() {
    const next = upcomingLang();
    this.inputs[next].set_value(this.text);
    setLang(next);
  }

  say(address, ok, key, detail = "") {
    this.last = { address, ok, key, detail };
  }

  // Runs one hc command for a terminal; one at a time per terminal.
  act(cx, address, args, doneKey, after) {
    if (this.busy.has(address)) return;
    this.busy.add(address);
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      try {
        r = outcome(await hc(args));
      } catch (e) {
        r = { ok: false, message: String(e?.message ?? e) };
      }
      this.busy.delete(address);
      this.say(address, r.ok, r.ok ? doneKey : "failed", r.message);
      if (r.ok) after?.();
      cx.notify();
    });
  }

  toggleAuto(cx) {
    this.auto = !this.auto;
    this.tracker.clear();
    // The redraw starts the work: render() calls wake().
    cx.notify();
  }

  // Looks at each waiting agent that is due, one attempt per agent at a time.
  // Called from render(), so it runs whenever Herdr reports a change, and from
  // the look-again.
  wake(cx) {
    if (!this.auto) return;
    const rows = this.waiting;
    this.tracker.prune(rows.map((r) => r.address));
    if (rows.length === 0) return;
    const io = {
      read: async (address) => {
        const r = await hc(readArgs(address, READ_LINES));
        const o = outcome(r);
        if (!o.ok) throw new Error(o.message);
        return r.stdout;
      },
      press: async (address, app) => outcome(await hc(approveArgs(address, app))),
      // Turned off while an attempt runs: its key is not sent.
      asks: (address) => this.auto && asksNow(address),
      stuck: (address, signature) => this.tracker.stuck(address, signature),
      limit: this.limit,
      now: () => Date.now(),
    };
    for (const row of rows) {
      const now = Date.now();
      if (this.busy.has(row.address) || !this.tracker.due(row.address, now)) continue;
      this.tracker.start(row.address);
      cx.spawn(async (cx) => {
        const result = await attempt(row.address, row.app, io);
        const news = this.tracker.finish(row.address, Date.now(), result);
        if (news) this.record(row, result);
        cx.notify();
      });
    }
    this.lookAgain(cx);
  }

  // One look-again, set once every attempt has ended and someone still waits:
  // a dialog that was held, or one whose key did nothing. Not set again until
  // it fires, and it does nothing if auto-approve was turned off meanwhile.
  lookAgain(cx) {
    if (this.recheck || !this.tracker.idle()) return;
    this.recheck = true;
    cx.timer.after(RECHECK_MS + 250, (cx) => {
      this.recheck = false;
      if (!this.auto || this.waiting.length === 0) return;
      this.wake(cx);
      cx.notify();
    });
  }

  record(row, result) {
    const command = (result.command ?? "").split("\n").find((l) => l.trim()) ?? "";
    this.log.unshift({ at: Date.now(), address: row.address, action: result.action, reason: result.reason, rule: result.rule, command });
    this.log.length = Math.min(this.log.length, LOG_SIZE);
    // Herdr already says an agent needs the person. This adds why it was not
    // approved for them, and only when a rule stopped it.
    if (result.action === "held" && result.reason === "rule") {
      notify({
        title: `${row.address} · ${tr("heldTitle")}`,
        body: `${result.rule}: ${command}`,
        level: "warning",
        action: row.pane ? { name: "pane.focus", args: { pane: row.pane } } : undefined,
      });
    }
  }

  // An entry's reason in words: the rule's id for a rule, hc's message for a failure.
  logText(e) {
    if (e.reason === "rule") return `${tr("r.rule")} ${e.rule}`;
    if (e.action === "failed") return `${tr("failed")}: ${e.reason}`;
    return tr(`r.${e.reason}`);
  }

  // Approve or deny: only if it still waits on its dialog, so a key never lands
  // in a prompt box or a different question.
  answer(cx, address, app, approve) {
    if (!asksNow(address)) {
      this.say(address, false, "notBlocked");
      cx.notify();
      return;
    }
    this.act(cx, address, approve ? approveArgs(address, app) : denyArgs(address, app), approve ? "approved" : "denied");
  }

  send(cx) {
    const target = this.target;
    const text = cleanPrompt(this.text);
    if (!target || !text || this.busy.has(target.address)) return;
    if (!canSend(asksNow(target.address) ? "blocked" : target.status)) {
      this.say(target.address, false, "sendBlocked");
      cx.notify();
      return;
    }
    this.act(cx, target.address, sendArgs(target.address, text), "sent", () => {
      this.text = "";
      for (const input of Object.values(this.inputs)) input.set_value("");
    });
  }

  // "space · tab": a tab nobody named is only a number, which says nothing.
  where(a, named) {
    const tab = named.has(a.tab) ? a.tab_name : null;
    return [a.space_name, tab].filter(Boolean).join(" · ") || a.title || a.address;
  }

  render(cx) {
    const t = theme();
    const groups = buildGroups(agents(), terminals(), machines());
    const sum = totals(groups);
    const named = new Set(spaces().flatMap((s) => s.tabs).filter((tab) => tab.named).map((tab) => tab.id));

    // Every row in list order, for choosing where the prompt goes.
    const flat = groups.flatMap((g) => g.agents.flatMap(({ a, subs }) => [
      { address: a.address, focused: a.focused, status: a.status, name: a.program?.name ?? a.app ?? "" },
      ...subs.map((s) => ({ address: s.t.address, focused: false, status: s.status, name: s.t.name || s.t.template || s.t.program?.name || "" })),
    ]));
    this.target = pickTarget(flat, this.picked);
    this.waiting = groups.filter((g) => g.layout === "ready").flatMap((g) => g.agents.flatMap(({ a, subs }) => [
      ...(a.status === "blocked" ? [{ address: a.address, app: a.app, pane: a.pane }] : []),
      ...subs.filter((s) => s.asks).map((s) => ({ address: s.t.address, app: s.t.report?.app ?? s.t.app, pane: null })),
    ]));
    // Herdr just told us something changed (or auto-approve was switched on).
    this.wake(cx);
    const targeted = this.target?.address;

    const pick = (address) => (_e, cx) => {
      this.picked = address;
      cx.notify();
    };

    const rows = groups.flatMap((g) => {
      const id = `g:${g.machine ?? ""}`;
      const open = !this.folded.has(id);
      // This computer's header only matters once there is another machine to tell apart.
      const lone = groups.length === 1;
      const header = lone ? [] : [groupHeader(t, g, open, (_e, cx) => {
        open ? this.folded.add(id) : this.folded.delete(id);
        cx.notify();
      })];
      if (!open) return header;
      const dim = g.layout !== "ready";
      if (g.agents.length === 0) return lone ? header : [...header, note(t, tr("none"))];
      return [
        ...header,
        ...g.agents.flatMap(({ a, subs }) => [
          agentRow(t, a, this.where(a, named), {
            dim,
            target: a.address === targeted,
            busy: this.busy.has(a.address),
            onPick: (e, cx) => {
              pick(a.address)(e, cx);
              run("pane.focus", { pane: a.pane });
            },
            onJump: () => run("pane.focus", { pane: a.pane }),
            onApprove: (_e, cx) => this.answer(cx, a.address, a.app, true),
            onDeny: (_e, cx) => this.answer(cx, a.address, a.app, false),
          }),
          ...subs.map((s) => subRow(t, s, {
            dim,
            target: s.t.address === targeted,
            busy: this.busy.has(s.t.address),
            // Picking a sub-agent only chooses it; ↗ opens it.
            onPick: pick(s.t.address),
            onJump: () => run("terminal.peek", { terminal: s.t.address }),
            onApprove: (_e, cx) => this.answer(cx, s.t.address, s.t.report?.app ?? s.t.app, true),
            onDeny: (_e, cx) => this.answer(cx, s.t.address, s.t.report?.app ?? s.t.app, false),
          })),
        ]),
      ];
    });

    const last = this.last && {
      address: this.last.address,
      ok: this.last.ok,
      text: [tr(this.last.key), this.last.detail].filter(Boolean).join(": "),
    };
    const sending = Boolean(this.target) && this.busy.has(this.target.address);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_l(1)
      .border_color(t.border)
      .text_size(13)
      .child(topBar(t, sum, this.auto, (_e, cx) => this.toggleAuto(cx), () => this.switchLang()))
      // With several machines each group says it has no agents; one line is enough.
      .when(flat.length === 0 && groups.length === 1, (el) => el.child(note(t, tr("empty"))))
      .child(v_flex().id("mc-list").flex_1().min_h(0).px(4).py(4).overflow_y_scrollbar().children(rows))
      .when(this.auto || this.log.length > 0, (el) => el.child(logBar(t, this.log.map((e) => ({ ...e, text: this.logText(e) })), this.logOpen, (_e, cx) => {
        this.logOpen = !this.logOpen;
        cx.notify();
      })))
      .child(promptBar(t, this.inputs[lang()], this.target, last, sending, this.inputFocused, (_e, cx) => this.send(cx)));
  }
}
