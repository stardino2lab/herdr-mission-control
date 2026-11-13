// Drawing only: every function takes the theme and plain data, and returns elements.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { tr, langButton } from "./i18n.js";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function icon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}

/** The status as a word in its color, with a mark in front. */
export function statusBadge(t, status) {
  const color = t[status] ?? t.dim;
  const word = div().text_color(color).child(tr(status ?? "unknown"));
  const base = h_flex().flex_none().gap(4).items_center().text_size(11);
  if (status === "working") return base.child(div().w(10).text_color(color).frames(SPIN, 90)).child(word);
  if (status === "blocked") return base.px(6).h(18).rounded(5).bg(color + "26").font_semibold().child(word);
  if (status === "done") return base.child(div().size(7).rounded(4).bg(color)).child(word);
  return base.child(div().size(7).rounded(4).border(1.5).border_color(color)).child(word);
}

// The auto-approve switch: loud while on, since it presses keys by itself.
function autoSwitch(t, on, onClick) {
  const color = on ? t.blocked : t.muted;
  return h_flex()
    .id("mc-auto")
    .flex_none()
    .px(6)
    .h(20)
    .gap(5)
    .items_center()
    .rounded(5)
    .border(1)
    .border_color(on ? color : t.border)
    .when(on, (el) => el.bg(color + "26"))
    .text_size(10.5)
    .text_color(color)
    .cursor_pointer()
    .hover((s) => s.bg(on ? color + "40" : t.hover))
    .tooltip(tr(on ? "autoOn" : "autoOff"))
    .on_click(onClick)
    .child(div().size(7).rounded(4).when(on, (el) => el.bg(color)).when(!on, (el) => el.border(1.5).border_color(color)))
    .child(tr("auto"));
}

const clock = (at) => {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
};

/**
 * What auto-approve did: one line of counts that opens the last few entries.
 * `log`: newest first, each { at, address, action, text, command }.
 */
export function logBar(t, log, open, onToggle) {
  const approved = log.filter((e) => e.action === "approved").length;
  const held = log.length - approved;
  const line = h_flex()
    .id("mc-log")
    .px(10)
    .h(24)
    .flex_none()
    .gap(8)
    .items_center()
    .text_size(11)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(onToggle)
    .child(div().w(10).flex_none().text_color(t.dim).child(open ? "▾" : "▸"))
    .child(div().text_color(approved ? t.done : t.dim).child(`${tr("logApproved")} ${approved}`))
    .child(div().text_color(held ? t.blocked : t.dim).child(`${tr("logHeld")} ${held}`));
  if (!open) return v_flex().flex_none().border_t(1).border_color(t.border).child(line);
  const entry = (e, i) => h_flex()
    .id(`mc-log-${i}`)
    .px(10)
    .h(20)
    .flex_none()
    .gap(6)
    .items_center()
    .text_size(10.5)
    .tooltip(e.command || e.text)
    .child(div().flex_none().text_color(t.dim).child(clock(e.at)))
    .child(div().flex_none().text_color(t.muted).child(e.address))
    .child(div().flex_none().text_color(e.action === "approved" ? t.done : t.blocked).child(e.text))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(e.command));
  return v_flex()
    .flex_none()
    .border_t(1)
    .border_color(t.border)
    .child(line)
    .when(log.length === 0, (el) => el.child(note(t, tr("logEmpty"))))
    .children(log.slice(0, 6).map(entry))
    .child(div().h(4));
}

/** The top bar: title, how many need the person, auto-approve, the language switch. */
export function topBar(t, sum, auto, onAuto, onLang) {
  // A dot and a number: the words differ a lot in length between languages
  // ("Braucht Freigabe"), and the bar must always have room for its two buttons.
  // The words are in the tooltip and in each group's header.
  const chip = (status) => div()
    .id(`mc-sum-${status}`)
    .flex_none()
    .text_size(11)
    .text_color(t[status] ?? t.dim)
    .tooltip(`${tr(status)} ${sum[status]}`)
    .child(`● ${sum[status]}`);
  return h_flex()
    .px(12)
    .h(36)
    .flex_none()
    .gap(8)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    // The title gives way first: it shrinks and is cut with an ellipsis.
    .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(tr("title")))
    .when(sum.blocked > 0, (el) => el.child(chip("blocked")))
    .when(sum.working > 0, (el) => el.child(chip("working")))
    .child(div().flex_1().min_w(0))
    .child(autoSwitch(t, auto, onAuto))
    .child(
      div()
        .id("mc-lang")
        .flex_none()
        .px(6)
        .h(20)
        .flex()
        .items_center()
        .rounded(5)
        .border(1)
        .border_color(t.border)
        .text_size(10.5)
        .text_color(t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(langButton().tip)
        .on_click(onLang)
        .child(langButton().label),
    );
}

/** A machine's header: folds its group, says when the machine can't be reached. */
export function groupHeader(t, g, open, onFold) {
  const off = g.layout !== "ready";
  const n = g.agents.length;
  return h_flex()
    .id(`mc-g-${g.machine ?? ""}`)
    .px(8)
    .h(28)
    .flex_none()
    .gap(6)
    .items_center()
    .text_size(11)
    .font_medium()
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(onFold)
    .child(div().w(10).flex_none().text_color(t.dim).child(open ? "▾" : "▸"))
    .child(div().truncate().text_color(off ? t.dim : t.muted).child(g.machine ?? tr("local")))
    .when(off, (el) => el.child(div().flex_none().text_color(g.layout === "unavailable" ? t.blocked : t.dim).child(tr(g.layout))))
    .child(div().flex_1())
    .when(g.counts.blocked > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`${tr("blocked")} ${g.counts.blocked}`)))
    .child(div().flex_none().text_color(t.dim).child(String(n)));
}

// A small square button. Its click never reaches the row under it.
function button(t, id, glyph, tip, color, onClick, off = false) {
  return div()
    .id(id)
    .flex_none()
    .w(20)
    .h(20)
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .text_size(12)
    .text_color(off ? t.dim : color)
    .when(off, (el) => el.opacity(0.5))
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.raised)))
    .tooltip(tip)
    .on_click((e, cx) => {
      cx.stop_propagation();
      if (!off) onClick(e, cx);
    })
    .child(glyph);
}

// Approve and deny, only while the row waits on an approval dialog.
function answers(t, address, h) {
  return [
    button(t, `mc-y-${address}`, "✓", tr("approve"), t.done, h.onApprove, h.busy),
    button(t, `mc-n-${address}`, "✗", tr("deny"), t.blocked, h.onDeny, h.busy),
  ];
}

/**
 * One agent on one line: icon, program, where it is, status, approve/deny, jump.
 * `h`: { onPick, onJump, onApprove, onDeny, busy, target, dim }.
 */
export function agentRow(t, a, where, h) {
  const pic = icon(a.program, 15, t.foreground);
  return h_flex()
    .id(`mc-a-${a.address}`)
    .px(8)
    .h(28)
    .flex_none()
    .gap(6)
    .items_center()
    .rounded(7)
    .border_l(2)
    .border_color(h.target ? t.accent : t.chrome)
    .when(a.focused, (el) => el.bg(t.selected))
    .when(h.dim, (el) => el.opacity(0.55))
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(h.onPick)
    .when(Boolean(pic), (el) => el.child(pic))
    .child(div().flex_none().max_w(96).truncate().text_color(t.foreground).child(a.program?.name ?? a.app ?? a.address))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where))
    .child(statusBadge(t, a.status))
    .when(a.status === "blocked", (el) => el.children(answers(t, a.address, h)))
    .child(button(t, `mc-j-${a.address}`, "↗", tr("jump"), t.muted, h.onJump));
}

/** A sub-agent under its parent, with the tree guides in front. Same `h`. */
export function subRow(t, s, h) {
  const k = s.t;
  const pic = icon(k.program, 13, t.muted);
  const guide = s.lines.map((l) => (l === "" ? "  " : `${l} `)).join("");
  return h_flex()
    .id(`mc-s-${k.address}`)
    .pl(14)
    .pr(8)
    .h(24)
    .flex_none()
    .gap(6)
    .items_center()
    .rounded(7)
    .border_l(2)
    .border_color(h.target ? t.accent : t.chrome)
    .text_size(12)
    .when(h.dim, (el) => el.opacity(0.55))
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(h.onPick)
    .child(div().flex_none().whitespace_nowrap().text_color(t.input).child(guide))
    .when(Boolean(pic), (el) => el.child(pic))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(k.name || k.template || k.program?.name || k.address))
    .child(statusBadge(t, s.status))
    .when(s.asks, (el) => el.children(answers(t, k.address, h)))
    .child(button(t, `mc-p-${k.address}`, "↗", tr("peek"), t.muted, h.onJump));
}

/** A line of quiet text: the empty list, a machine with nothing running. */
export function note(t, text) {
  return div().px(12).py(6).text_size(12).text_color(t.dim).child(text);
}

/**
 * The bottom: what the last action did, then one line to type a prompt into.
 * `last`: { address, ok, text } or null. `target`: { address, name } or null.
 */
export function promptBar(t, input, target, last, sending, focused, onSend) {
  const off = !target || sending;
  return v_flex()
    .flex_none()
    .border_t(1)
    .border_color(t.border)
    .when(Boolean(last), (el) =>
      el.child(
        div()
          .px(10)
          .pt(6)
          .text_size(11)
          .text_color(last.ok ? t.dim : t.blocked)
          .child(`${last.address} · ${last.text}`),
      ),
    )
    .child(
      h_flex()
        .p(8)
        .gap(6)
        .items_center()
        .child(
          div()
            .flex_none()
            .max_w(110)
            .truncate()
            .px(6)
            .h(22)
            .flex()
            .items_center()
            .rounded(5)
            .bg(t.raised)
            .text_size(11)
            .text_color(target ? t.foreground : t.dim)
            .tooltip(target ? `${target.address} · ${target.name}` : tr("noTarget"))
            .child(target ? `${target.address} ▸` : "—"),
        )
        .child(
          Input.new(input)
            .flex_1()
            .min_w(0)
            .h(26)
            .px(8)
            .rounded(6)
            .border_1()
            .border_color(focused ? t.accent : t.input)
            .bg(t.background)
            .text_size(12)
            .text_color(t.foreground),
        )
        .child(button(t, "mc-send", sending ? "…" : "⏎", sending ? tr("sending") : tr("send"), t.accent, onSend, off)),
    );
}
