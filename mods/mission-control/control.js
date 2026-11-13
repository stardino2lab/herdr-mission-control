// What to tell herdr-core (`hc`) for each action. Pure: it only builds argument
// lists and reads results, so it runs under plain node for tests.

// The keys that answer an agent's approval dialog, by the app the agent reports
// (AgentInfo.app). Enter takes the dialog's default "yes"; Esc dismisses it.
// Checked on a live Claude Code 2.1.322 dialog; other agents use the default until checked.
const KEYS = {
  default: { approve: ["enter"], deny: ["esc"] },
  "claude-code": { approve: ["enter"], deny: ["esc"] },
};

export const keysFor = (app) => KEYS[app] ?? KEYS.default;

// "--" ends hc's own options, so an address or a prompt that starts with "-"
// (say "--force") is never read as a flag.
export const approveArgs = (address, app) => ["keys", "--", address, ...keysFor(app).approve];
export const denyArgs = (address, app) => ["keys", "--", address, ...keysFor(app).deny];
export const sendArgs = (address, text) => ["send", "--", address, text];
/** The screen as text, with `lines` of history above it when asked for. */
export const readArgs = (address, lines = 0) => (lines > 0 ? ["read", "--lines", String(lines), "--", address] : ["read", "--", address]);

/** A prompt as one line of plain text: line breaks and tabs become spaces, other
 *  control characters (Esc, which starts terminal escape sequences) are dropped. */
export function cleanPrompt(text) {
  return (text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
}

/** Typing into an approval dialog would answer it with whatever was typed. */
export const canSend = (status) => status !== "blocked";

// hc reports a failure as JSON: {"error":{"message":"no terminal \"t9\"", ...}}.
function hcError(text) {
  try {
    const error = JSON.parse(text)?.error;
    if (error) return String(error.message ?? error.kind ?? "error");
  } catch {}
  return null;
}

/** An ExecResult as { ok, message }: hc's own error message when it gave one,
 *  else the first line it wrote. A JSON error counts even with exit code 0. */
export function outcome(result) {
  const out = (result?.stdout ?? "").trim();
  const err = (result?.stderr ?? "").trim();
  const said = hcError(out) ?? hcError(err);
  if (said) return { ok: false, message: said };
  if (result?.code === 0) return { ok: true, message: "" };
  return { ok: false, message: (err || out).split(/\r?\n/)[0] || `exit ${result?.code ?? "?"}` };
}

/** The agent the prompt goes to: the one picked if it is still there, else the
 *  focused one, else the first. `rows`: { address, focused } in list order. */
export function pickTarget(rows, picked) {
  return rows.find((r) => r.address === picked) ?? rows.find((r) => r.focused) ?? rows[0] ?? null;
}
