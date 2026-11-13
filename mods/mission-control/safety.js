// Decides whether an approval dialog may be answered without the person.
// Pure: what detector.js read goes in, a verdict comes out.
//
// The default answer is "hold". It approves only when the whole dialog was
// read, it is a kind this mod answers, and nothing in it matches a rule below.
// A rule that fires on something harmless costs one click; a rule that misses
// costs whatever the command destroys, so the rules lean towards firing.
//
// What this cannot see: what a script does (`bash build.sh`, `npm run x`),
// what a program does with its arguments, and anything the dialog did not
// show. It is a filter for obvious damage, not a sandbox.

/** The kinds of dialog this mod answers on its own. Fetches and tool calls reach
 *  outside the machine in ways a text rule can't weigh, so they wait. */
export const AUTO_KINDS = new Set(["bash", "edit", "write", "read"]);

const MAX_CHARS = 4000;
const MAX_LINES = 80;

// Invisible or direction-changing characters: what is shown may not be what runs.
const ODD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;

// B: where a command word may start (not in the middle of a name or a path).
// S: the rest of one command, up to the next ; & | or line break.
const B = "(?:^|[^\\w.-])";
const S = "[^;&|\\n]*";
const re = (source) => new RegExp(source);

// Each rule: an id for the log, and a pattern tried on lowercased text.
export const RULES = [
  // Deleting
  ["rm-flags", re(`${B}(?:rm|remove-item|ri|del|erase|rd|rmdir)(?=\\s)${S}?\\s-{1,2}[a-z-]*(?:r|f|rec\\w*|fo\\w*)\\b`)],
  ["rm-root", re(`${B}rm(?=\\s)${S}?\\s(?:/|~|\\*|\\.\\.?|\\$home|\\$\\{home\\})/?(?:\\s|$)`)],
  ["rd-s", re(`${B}(?:rd|rmdir)\\s+${S}?/s\\b`)],
  ["del-switch", re(`${B}(?:del|erase)\\s+${S}?/[sqf]\\b`)],
  ["shred", re(`${B}(?:shred|srm|wipe)(?:\\s|$)`)],
  ["find-exec", re(`${B}find(?=\\s)${S}?\\s-(?:delete|exec|execdir|ok)\\b`)],
  ["truncate", re(`${B}truncate\\s+${S}?-s`)],

  // Elevation
  ["sudo", re(`${B}(?:sudo|doas|su|runas|pkexec|gsudo)(?:\\s|$)`)],
  ["runas-verb", re(`-verb\\s+runas\\b`)],

  // Git: losing work or rewriting what others have
  ["git-reset-hard", re(`${B}git\\b${S}?\\breset\\b${S}?--hard`)],
  ["git-push-force", re(`${B}git\\b${S}?\\bpush\\b${S}?(?:\\s-[a-z]*f\\b|--force|--mirror|--delete|\\s-d\\b|\\s\\+\\S|\\s:\\S)`)],
  ["git-clean", re(`${B}git\\b${S}?\\bclean\\b${S}?\\s-[a-z]*f`)],
  ["git-discard", re(`${B}git\\b${S}?\\b(?:checkout|restore)\\b${S}?(?:\\s-f\\b|--force|(?:\\s|^)\\.(?:\\s|$))`)],
  ["git-branch-delete", re(`${B}git\\b${S}?\\bbranch\\b${S}?\\s(?:-d\\b|--delete)`)],
  ["git-stash-drop", re(`${B}git\\b${S}?\\bstash\\s+(?:drop|clear)\\b`)],
  ["git-history", re(`${B}git\\b${S}?\\b(?:filter-branch|filter-repo|reflog\\s+expire|update-ref\\s+-d|gc\\b${S}?--prune)`)],
  ["git-worktree-force", re(`${B}git\\b${S}?\\bworktree\\s+remove\\b${S}?(?:--force|\\s-f\\b)`)],
  ["gh-delete", re(`${B}gh\\b${S}?\\b(?:repo|release|secret)\\s+delete\\b`)],

  // Disks and devices
  ["disk", re(`${B}(?:dd|mkfs(?:\\.\\w+)?|fdisk|parted|wipefs|diskpart|format-volume|clear-disk|bcdedit|cipher)(?:\\s|$)`)],
  ["format", re(`(?:^|[;&|\\n]\\s*)format(?:\\.com)?\\s+/?[a-z]:`)],
  ["device-write", re(`>\\s*/dev/(?:sd|nvme|hd|disk|mem|mapper)`)],

  // Permissions and ownership
  ["chmod", re(`${B}(?:chmod|chown|chgrp)\\b${S}?(?:\\s-[a-z]*r\\b|--recursive|\\b777\\b|a\\+rwx)`)],
  ["acl", re(`${B}(?:icacls|takeown|cacls)(?:\\s|$)`)],

  // Power, processes, services
  ["power", re(`${B}(?:shutdown|reboot|halt|poweroff|stop-computer|restart-computer)(?:\\s|$)`)],
  ["kill-many", re(`${B}(?:killall|pkill|taskkill)(?:\\s|$)`)],
  ["kill-all", re(`${B}kill\\s+(?:-\\w+\\s+)*-1(?:\\s|$)`)],
  ["service", re(`${B}(?:systemctl|service|sc|launchctl)\\b${S}?\\b(?:stop|disable|mask|delete|unload|remove)\\b`)],
  ["fork-bomb", re(`:\\(\\)\\s*\\{`)],
  ["crontab", re(`${B}crontab\\s+${S}?-r\\b`)],

  // Running something this filter can't read
  ["pipe-shell", re(`\\|\\s*(?:sudo\\s+)?(?:(?:ba|z|da|k|fi)?sh|iex|invoke-expression|python[\\d.]*|node|perl|ruby|pwsh|powershell|cmd)\\b`)],
  ["shell-c", re(`${B}(?:ba|z|da|k|fi)?sh(?=\\s)${S}?\\s-\\w*c\\b`)],
  ["shell-stdin", re(`${B}(?:ba|z|da|k|fi)?sh\\b${S}?<<`)],
  ["powershell-c", re(`${B}(?:pwsh|powershell)(?:\\.exe)?\\b${S}?\\s-(?:c|command|e|ec|enc\\w*|f|file)\\b`)],
  ["cmd-c", re(`${B}cmd(?:\\.exe)?\\s+/[ck]\\b`)],
  ["eval", re(`${B}(?:eval|iex|invoke-expression)(?:\\s|$)`)],
  ["inline-code", re(`${B}(?:python[\\d.]*|node|perl|ruby|php|deno|bun)\\s+(?:\\S+\\s+)?-{1,2}(?:c|e|eval|exec|r|p)\\b`)],
  ["computed-command", re(`(?:^|[;&|\\n]\\s*)(?:\\$[\\w({]|\`)`)],
  ["decode", re(`${B}base64\\b${S}?(?:\\s-d\\b|--decode)|frombase64string|${B}xxd\\b${S}?\\s-r\\b`)],
  ["xargs", re(`${B}xargs(?:\\s|$)`)],

  // Things that leave the machine or can't be taken back
  ["publish", re(`${B}(?:npm|yarn|pnpm|cargo|gem)\\s+${S}?\\b(?:publish|push)\\b|${B}twine\\s+upload\\b`)],
  ["docker", re(`${B}docker\\b${S}?\\b(?:system\\s+prune|volume\\s+(?:rm|prune)|rmi|image\\s+prune)\\b`)],
  ["kubectl", re(`${B}(?:kubectl|helm)\\b${S}?\\b(?:delete|uninstall|drain)\\b`)],
  ["terraform", re(`${B}(?:terraform|tofu|pulumi)\\b${S}?\\b(?:destroy|apply|up)\\b`)],
  ["cloud-delete", re(`${B}(?:aws|gcloud|az)\\b${S}?\\b(?:rm|rb|delete|terminate-instances|purge)\\b`)],
  ["sql-drop", re(`\\b(?:drop|truncate)\\s+(?:database|table|schema)\\b`)],

  // Windows settings and accounts
  ["registry", re(`${B}reg(?:\\.exe)?\\s+(?:delete|add|import|restore)\\b|(?:remove|set|new)-item(?:property)?\\b${S}?hk(?:lm|cu|cr|u)\\b`)],
  ["execution-policy", re(`set-executionpolicy\\b`)],
  ["accounts", re(`${B}net\\s+(?:user|localgroup)\\b|${B}(?:useradd|userdel|usermod|passwd)(?:\\s|$)`)],

  // Files that hold secrets or change how the machine and the agent behave
  ["path-env", re(`(?:^|[\\s"'=/\\\\(])\\.env(?:\\.[\\w.-]+)?(?:$|[\\s"')])`)],
  ["path-ssh", re(`\\.ssh[/\\\\]|\\bid_(?:rsa|ed25519|ecdsa|dsa)\\b|authorized_keys|known_hosts`)],
  ["path-git", re(`\\.git[/\\\\](?:hooks|config)\\b`)],
  ["path-shell-rc", re(`(?:^|[\\s"'/\\\\])\\.(?:bashrc|zshrc|profile|bash_profile|zprofile|zshenv|npmrc|netrc|pypirc)\\b|\\$profile\\b|microsoft\\.powershell_profile`)],
  ["path-credentials", re(`\\.aws[/\\\\]credentials|\\.kube[/\\\\]config|\\.docker[/\\\\]config\\.json|\\.gnupg[/\\\\]`)],
  ["path-system", re(`(?:^|[\\s"'=>])/(?:etc|boot|sys|proc)/|[/\\\\]system32\\b|[a-z]:[/\\\\]windows[/\\\\]`)],
  ["path-agent-config", re(`\\.claude[/\\\\]settings|\\.codex[/\\\\]config|\\.config[/\\\\]herdr`)],
  ["path-ci", re(`\\.github[/\\\\]workflows`)],
];

// The same text several ways, so a line wrap or a quote in the middle of a
// word doesn't hide it: as shown; wrapped lines joined with a space and with
// nothing; and with quotes, backslashes and carets taken out.
function variants(command) {
  const base = command.toLowerCase().replace(/\r/g, "").replace(/\\\n/g, "");
  const spaced = base.replace(/[ \t]+/g, " ");
  const oneLine = spaced.replace(/\n+/g, " ");
  const joined = spaced.replace(/\n+/g, "");
  const bare = (s) => s.replace(/\$\{?ifs\}?/g, " ").replace(/['"\\^]/g, "").replace(/ +/g, " ");
  return [...new Set([spaced, oneLine, joined, bare(oneLine), bare(joined)])];
}

/** The first rule the text matches, or null. */
export function firstRule(command) {
  for (const text of variants(command ?? "")) {
    for (const [id, pattern] of RULES) if (pattern.test(text)) return id;
  }
  return null;
}

const hold = (reason, rule = null) => ({ verdict: "hold", reason, rule });

/**
 * @param dialog what detector.parseDialog returned
 * @returns {{ verdict: "approve" | "hold", reason: string, rule: string | null }}
 *   reason: "ok" when approving; otherwise the detector's `why`, or
 *   "kind" | "too-long" | "odd-characters" | "rule" (with the rule's id)
 */
export function judge(dialog) {
  if (!dialog?.found) return hold(dialog?.why ?? "no-dialog");
  if (!dialog.complete) return hold(dialog.why ?? "incomplete");
  if (!AUTO_KINDS.has(dialog.kind)) return hold("kind");
  const command = dialog.command ?? "";
  if (!command.trim()) return hold("empty");
  if (command.length > MAX_CHARS || command.split("\n").length > MAX_LINES) return hold("too-long");
  if (ODD.test(command)) return hold("odd-characters");
  const rule = firstRule(command);
  if (rule) return hold("rule", rule);
  return { verdict: "approve", reason: "ok", rule: null };
}
