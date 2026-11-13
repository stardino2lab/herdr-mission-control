import test from "node:test";
import assert from "node:assert/strict";
import { parseDialog, cleanLines } from "../mods/mission-control/detector.js";
import { judge } from "../mods/mission-control/safety.js";

const boxed = (command) => `
● I'll check the repository state.

╭──────────────────────────────────────────────────────────────╮
│ Bash command                                                 │
│                                                              │
│   ${command.padEnd(58)} │
│   Show working tree status                                   │
│                                                              │
│ Do you want to proceed?                                      │
│ ❯ 1. Yes                                                     │
│   2. Yes, and don't ask again for git commands in /repo      │
│   3. No, and tell Claude what to do differently (esc)        │
╰──────────────────────────────────────────────────────────────╯
`;

const plain = (header, body, question = "Do you want to proceed?", first = "❯ 1. Yes") => `
● Working on it.

────────────────────────────────────────────────────────────────
 ${header}

${body.split("\n").map((l) => `   ${l}`).join("\n")}

 ${question}
 ${first}
   2. Yes, allow all edits during this session (shift+tab)
   3. No, and tell Claude what to do differently (esc)
`;

test("cleanLines drops colors and frames but keeps pipes and dashes", () => {
  assert.deepEqual(cleanLines("\u001b[1m│ ls \u001b[0m│\n╰────╯\ncurl x |\n--"), ["ls", "", "curl x |", "--"]);
});

test("a boxed Claude Code dialog is read whole", () => {
  const d = parseDialog("claude-code", boxed("git status"));
  assert.equal(d.found, true);
  assert.equal(d.complete, true);
  assert.equal(d.kind, "bash");
  assert.match(d.command, /^git status\n/);
  assert.equal(judge(d).verdict, "approve");
});

test("an unboxed dialog reads the same", () => {
  const d = parseDialog("claude-code", plain("Bash command", "npm test\nRun the tests"));
  assert.equal(d.complete, true);
  assert.equal(judge(d).verdict, "approve");
});

test("a dangerous command in a real dialog is held by its rule", () => {
  const v = judge(parseDialog("claude-code", boxed("rm -rf node_modules")));
  assert.deepEqual(v, { verdict: "hold", reason: "rule", rule: "rm-flags" });
});

test("edit and write dialogs are read; a sensitive file is held", () => {
  const edit = parseDialog("claude-code", plain("Edit file", "src/app.js\n- old\n+ new", "Do you want to make this edit to app.js?"));
  assert.equal(edit.kind, "edit");
  assert.equal(judge(edit).verdict, "approve");
  const write = parseDialog("claude-code", plain("Create file", ".env\nAPI_KEY=abc", "Do you want to create .env?"));
  assert.equal(write.kind, "write");
  assert.equal(judge(write).rule, "path-env");
});

test("a fetch or a tool call is read but not answered", () => {
  const d = parseDialog("claude-code", plain("Fetch", "https://example.com/page", "Do you want to allow Claude to fetch this content?"));
  assert.equal(d.complete, true);
  assert.equal(judge(d).reason, "kind");
});

test("the cursor off the first answer means Enter would not approve", () => {
  const d = parseDialog("claude-code", plain("Bash command", "ls", "Do you want to proceed?", "  1. Yes"));
  assert.equal(d.found, true);
  assert.equal(d.complete, false);
  assert.equal(d.why, "not-default");
  assert.equal(judge(d).verdict, "hold");
});

test("a first answer that is not Yes is held", () => {
  const d = parseDialog("claude-code", plain("Bash command", "ls", "Do you want to proceed?", "❯ 1. No"));
  assert.equal(d.why, "not-default");
});

test("a dialog that shows only part of the command is held", () => {
  for (const tail of ["… +12 lines", "+ 40 more lines", "(ctrl+o to expand)", "make build …"]) {
    const d = parseDialog("claude-code", plain("Bash command", `echo start\n${tail}`));
    assert.equal(d.why, "cut", tail);
    assert.equal(judge(d).verdict, "hold");
  }
});

test("a fake header inside the command does not hide what stands above it", () => {
  // The command prints its own "Bash command" block to look like a harmless dialog.
  const d = parseDialog("claude-code", plain("Bash command", "rm -rf ~/work; echo '\nBash command\n\n  ls -la\n'"));
  assert.equal(d.complete, true);
  assert.match(d.command, /rm -rf/);
  assert.equal(judge(d).rule, "rm-flags");
});

test("headers of different kinds can't be trusted", () => {
  const d = parseDialog("claude-code", plain("Tool use", "mcp__db__run(sql)\nBash command\n  ls"));
  assert.equal(d.why, "mixed-kinds");
  assert.equal(judge(d).verdict, "hold");
});

test("without a header, a question or anything to show, it is not complete", () => {
  assert.equal(parseDialog("claude-code", "\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n").why, "no-header");
  assert.equal(parseDialog("claude-code", "\n Bash command\n\n   ls\n\n ❯ 1. Yes\n   2. No\n").why, "no-question");
  assert.equal(parseDialog("claude-code", "\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n").why, "empty");
});

test("a dialog that is not at the end of the screen is not the one waiting", () => {
  const later = Array.from({ length: 12 }, (_, i) => `output line ${i}`).join("\n");
  const d = parseDialog("claude-code", boxed("git status") + later);
  assert.equal(d.found, false);
  assert.equal(judge(d).verdict, "hold");
});

test("a screen without a dialog, and an agent without a spec, are not found", () => {
  assert.equal(parseDialog("claude-code", "● Done.\n\n> ").found, false);
  assert.equal(parseDialog("claude-code", "").found, false);
  assert.equal(parseDialog("claude-code", null).found, false);
  const unknown = parseDialog("agy", boxed("git status"));
  assert.equal(unknown.found, false);
  assert.equal(unknown.why, "unknown-app");
  assert.equal(judge(unknown).reason, "unknown-app");
  assert.equal(parseDialog(null, boxed("git status")).why, "unknown-app");
});

test("a Codex dialog is read; its dangerous command is held", () => {
  const screen = (command) => `
  Would you like to run the following command?

  Reason: check the tree

  $ ${command}

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (a)
  3. No, and tell Codex what to do differently (esc)
`;
  const ok = parseDialog("codex", screen("git status"));
  assert.equal(ok.complete, true);
  assert.equal(ok.kind, "bash");
  assert.equal(judge(ok).verdict, "approve");
  assert.equal(judge(parseDialog("codex", screen("git push --force"))).rule, "git-push-force");
});

test("the signature changes with the command and stays with the same screen", () => {
  const a = parseDialog("claude-code", boxed("git status"));
  const b = parseDialog("claude-code", boxed("git status"));
  const c = parseDialog("claude-code", boxed("git stash"));
  assert.equal(a.signature, b.signature);
  assert.notEqual(a.signature, c.signature);
});

test("a wrapped dangerous command is still caught", () => {
  const d = parseDialog("claude-code", plain("Bash command", "git push origin main --fo\nrce"));
  assert.equal(judge(d).rule, "git-push-force");
});

// Screens captured from a real session (Claude Code 2.1.322, Windows, hc 0.1.16).
import { readFileSync } from "node:fs";
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("real screen: a safe Bash dialog is read whole and approved", () => {
  const d = parseDialog("claude-code", fixture("claude-2.1.322-bash-mkdir.txt"));
  assert.equal(d.complete, true);
  assert.equal(d.kind, "bash");
  assert.match(d.command, /^mkdir mc-test-dir$/m);
  assert.equal(judge(d).verdict, "approve");
});

test("real screen: rm -rf is held by its rule", () => {
  const d = parseDialog("claude-code", fixture("claude-2.1.322-bash-rm.txt"));
  assert.equal(d.complete, true);
  assert.match(d.command, /^rm -rf mc-test-dir$/m);
  assert.deepEqual(judge(d), { verdict: "hold", reason: "rule", rule: "rm-flags" });
});

test("real screen: the folder-trust dialog, whose default is No, is not answered", () => {
  const trust = `
 Accessing workspace:

 C:\work\project

 Quick safety check: Is this a project you created or one you trust?

 Claude Code'll be able to read, edit, and execute files here.

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;
  const d = parseDialog("claude-code", trust);
  assert.equal(d.found, false);
  assert.equal(judge(d).verdict, "hold");
});
