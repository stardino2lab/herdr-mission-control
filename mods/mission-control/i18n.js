// English / Korean strings. The choice is shared so every copy of the mod follows it.
// Another language is one more table in STR with the same keys.

import { shared, setShared } from "herdr";

const KEY = "mission-control.lang";

const STR = {
  ko: {
    title: "관제탑",
    local: "이 컴퓨터",
    working: "실행",
    blocked: "승인대기",
    done: "완료",
    idle: "유휴",
    unknown: "알 수 없음",
    loading: "연결 중",
    unavailable: "연결 끊김",
    jump: "이 에이전트로 이동",
    peek: "서브에이전트 보기",
    lang: "English로 전환",
    empty: "상태를 보고하는 에이전트가 없습니다. 에이전트를 시작하면 여기에 나타납니다.",
    none: "에이전트 없음",
    approve: "승인 (Enter)",
    deny: "거절 (Esc)",
    send: "전송",
    placeholder: "프롬프트 입력 후 Enter",
    noTarget: "보낼 에이전트 없음",
    approved: "승인 보냄",
    denied: "거절 보냄",
    sent: "프롬프트 보냄",
    sending: "보내는 중…",
    notBlocked: "이미 승인대기 상태가 아님. 보내지 않음",
    sendBlocked: "승인대기 중에는 프롬프트를 보낼 수 없음. 먼저 승인 또는 거절",
    failed: "실패",
    auto: "자동승인",
    autoOn: "자동승인 켜짐. 위험 규칙에 안 걸리고 끝까지 읽힌 승인창만 승인함. 스크립트 내부는 못 봄. 끄려면 클릭",
    autoOff: "자동승인 꺼짐. 켜려면 클릭 (앱을 다시 열면 꺼진 상태로 시작)",
    logApproved: "자동승인",
    logHeld: "보류",
    logEmpty: "아직 기록 없음",
    heldTitle: "자동승인 보류",
    "r.ok": "승인함",
    "r.rule": "위험 규칙",
    "r.no-dialog": "승인창 못 찾음",
    "r.unknown-app": "모르는 에이전트",
    "r.no-header": "승인창 머리말 없음",
    "r.mixed-kinds": "승인창 종류 불분명",
    "r.no-question": "질문 줄 없음",
    "r.not-default": "커서가 Yes에 없음",
    "r.cut": "내용이 잘림",
    "r.empty": "내용 없음",
    "r.kind": "자동승인 안 하는 종류",
    "r.too-long": "너무 김",
    "r.odd-characters": "보이지 않는 문자",
    "r.changed": "읽는 사이 화면 바뀜",
    "r.not-blocked": "승인대기 아님",
    "r.rate": "분당 한도 초과",
    "r.no-effect": "승인 키가 안 먹힘",
    "r.read-failed": "화면 읽기 실패",
  },
  en: {
    title: "Mission Control",
    local: "This computer",
    working: "Working",
    blocked: "Needs approval",
    done: "Done",
    idle: "Idle",
    unknown: "Unknown",
    loading: "Connecting",
    unavailable: "Disconnected",
    jump: "Go to this agent",
    peek: "Peek at this sub-agent",
    lang: "한국어로 전환",
    empty: "No agent is reporting a status yet. Start an agent and it shows up here.",
    none: "No agents",
    approve: "Approve (Enter)",
    deny: "Deny (Esc)",
    send: "Send",
    placeholder: "Type a prompt, then Enter",
    noTarget: "No agent to send to",
    approved: "Approval sent",
    denied: "Denial sent",
    sent: "Prompt sent",
    sending: "Sending…",
    notBlocked: "No longer waiting for approval. Nothing sent",
    sendBlocked: "Can't send a prompt while it waits for approval. Approve or deny first",
    failed: "Failed",
    auto: "Auto-approve",
    autoOn: "Auto-approve is on. It approves only dialogs read to the end that match no danger rule. It can't see inside scripts. Click to turn off",
    autoOff: "Auto-approve is off. Click to turn on (it starts off each time the app opens)",
    logApproved: "Auto-approved",
    logHeld: "Held",
    logEmpty: "Nothing yet",
    heldTitle: "Auto-approve held",
    "r.ok": "approved",
    "r.rule": "danger rule",
    "r.no-dialog": "no dialog found",
    "r.unknown-app": "unknown agent",
    "r.no-header": "dialog has no header",
    "r.mixed-kinds": "dialog kind unclear",
    "r.no-question": "no question line",
    "r.not-default": "cursor not on Yes",
    "r.cut": "content cut off",
    "r.empty": "nothing shown",
    "r.kind": "a kind not auto-approved",
    "r.too-long": "too long",
    "r.odd-characters": "invisible characters",
    "r.changed": "screen changed while reading",
    "r.not-blocked": "not waiting for approval",
    "r.rate": "over the per-minute limit",
    "r.no-effect": "the approve key did nothing",
    "r.read-failed": "could not read the screen",
  },
};

// Until the person picks one: Korean on a Korean system, English everywhere else.
function systemLang() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    return locale.toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "en";
  }
}

export const lang = () => {
  const picked = shared(KEY);
  return picked in STR ? picked : systemLang();
};
export const toggleLang = () => setShared(KEY, lang() === "ko" ? "en" : "ko");
/** A string in a given language, whatever is shown now. */
export const trIn = (language, key) => STR[language]?.[key] ?? key;
export const tr = (key) => STR[lang()][key] ?? STR.en[key] ?? key;
