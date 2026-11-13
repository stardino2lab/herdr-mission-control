// Reads an agent's approval dialog off its terminal screen. Pure: text in, facts out.
//
// It never decides anything. It says what it could read and whether it read all
// of it; safety.js decides. Anything it does not recognise comes back as
// "not found" or "not complete", and both mean: leave it to the person.

// What each agent's dialog looks like, by the app it reports (AgentInfo.app).
//   headers:  a line that opens a dialog, and the kind of thing it asks about
//   ask:      the question the dialog puts
//   first:    the first answer in its list (with or without the cursor on it)
//   selected: that first answer with the cursor on it and reading "Yes", so
//             that Enter approves
//   cut:      marks that the dialog shows only part of what it asks about
// "claude-code" is checked against live screens of Claude Code 2.1.322 (see
// test/fixtures). "codex" is written from how its dialog is known to look and
// not yet checked against a live screen. An agent without an entry is never read.
export const SPECS = {
  "claude-code": {
    headers: [
      [/^Bash command\b/i, "bash"],
      [/^Edit file\b/i, "edit"],
      [/^(?:Create|Write|Overwrite) file\b/i, "write"],
      [/^Read file\b/i, "read"],
      [/^Fetch\b/i, "fetch"],
      [/^Tool use\b/i, "tool"],
    ],
    ask: /^Do you want to\b.*\?$/i,
    first: /^(?:[❯>]\s*)?1\.\s+\S/,
    selected: /^[❯>]\s*1\.\s+Yes\b/i,
    cut: [/\+\s*\d+\s+(?:more\s+)?lines?\b/i, /…\s*$/, /\bctrl\+[a-z] to (?:expand|show)/i],
  },
  codex: {
    headers: [
      [/^Would you like to run the following command\?/i, "bash"],
      [/^Would you like to (?:make|apply) the following (?:edits|changes)\?/i, "edit"],
    ],
    ask: /^Would you like to\b.*\?$/i,
    first: /^(?:[›❯>]\s*)?1\.\s+\S/,
    selected: /^[›❯>]\s*1\.\s+Yes\b/i,
    cut: [/\+\s*\d+\s+(?:more\s+)?lines?\b/i, /…\s*$/],
  },
};

// Terminal escape sequences: CSI, OSC, and two-character escapes.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// A dialog's frame. Only box-drawing characters: an ASCII "|" or "-" may be
// part of the command (a pipe at the end of a wrapped line), so they stay.
const EDGE = /^[\s│┃║]+|[\s│┃║]+$/g;
const RULE = /^[\s─━═╭╮╰╯┌┐└┘┄┈╌]+$/;

// How far below the first answer the screen may go on: the other answers and a
// hint line. More than that and the dialog is not what the screen ends with.
const TAIL = 8;

/** The screen as trimmed lines without colors or frames; frame-only lines become "". */
export function cleanLines(screen) {
  return (screen ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => {
      const bare = line.replace(ANSI, "");
      return RULE.test(bare) ? "" : bare.replace(EDGE, "");
    });
}

// A short fingerprint of what was read, to tell whether the same dialog is
// still on screen a moment later.
function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h.toString(16)}`;
}

const NOT_FOUND = { found: false, complete: false, why: "no-dialog", kind: null, command: null, signature: null };

/**
 * Reads the approval dialog at the end of a terminal's screen.
 *
 * @param app    the agent's app name (AgentInfo.app), e.g. "claude-code"
 * @param screen the terminal's recent text (`hc read <t> --lines N`)
 * @returns {{ found: boolean, complete: boolean, why: string | null,
 *            kind: string | null, command: string | null, signature: string | null }}
 *   found:     a dialog of this agent ends the screen
 *   complete:  all of it was read and Enter would approve it
 *   why:       when not found or not complete, the reason:
 *              "unknown-app" | "no-dialog" | "no-header" | "mixed-kinds" |
 *              "no-question" | "not-default" | "cut" | "empty"
 *   kind:      "bash" | "edit" | "write" | "read" | "fetch" | "tool"
 *   command:   everything the dialog shows about what it asks, as lines
 *   signature: a fingerprint of kind and command
 */
export function parseDialog(app, screen) {
  const spec = SPECS[app];
  if (!spec) return { ...NOT_FOUND, why: "unknown-app" };

  const lines = cleanLines(screen);
  while (lines.length && lines.at(-1) === "") lines.pop();

  // The answer list: its last "1. …" line, with little but answers after it.
  let first = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (spec.first.test(lines[i])) { first = i; break; }
  }
  if (first < 0) return NOT_FOUND;
  if (lines.slice(first + 1).filter(Boolean).length > TAIL) return NOT_FOUND;

  // Every line above that could open a dialog. The topmost one is where
  // reading starts: a command that prints a fake header inside its own text
  // must not hide what stands above that fake header. A header of another kind
  // left in the history widens what is read, which only makes it stricter.
  const heads = [];
  for (let i = 0; i < first; i++) {
    const hit = spec.headers.find(([re]) => re.test(lines[i]));
    if (hit) heads.push({ i, kind: hit[1] });
  }
  const partial = (why, extra = {}) => ({ found: true, complete: false, why, kind: null, command: null, signature: null, ...extra });
  if (heads.length === 0) return partial("no-header");

  const top = heads[0].i;
  // The header nearest the answers names what is being asked. If the headers
  // disagree, one of them is not this dialog's and the kind can't be trusted.
  const kind = heads.at(-1).kind;
  const body = lines.slice(top + 1, first);
  const command = body.filter(Boolean).join("\n");
  const read = { kind, command, signature: fingerprint(`${kind}\n${command}`) };

  if (heads.some((h) => h.kind !== kind)) return partial("mixed-kinds", read);
  if (!lines.slice(top, first).some((l) => spec.ask.test(l))) return partial("no-question", read);
  if (!spec.selected.test(lines[first])) return partial("not-default", read);
  if (body.some((l) => spec.cut.some((re) => re.test(l)))) return partial("cut", read);
  // Something besides the question itself must be shown.
  if (!body.some((l) => l && !spec.ask.test(l))) return partial("empty", read);

  return { found: true, complete: true, why: null, ...read };
}
