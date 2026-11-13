// Which language is shown. The choice is shared so every copy of the mod follows it.
// The strings themselves, and the list of languages, are in strings.js.

import { shared, setShared } from "herdr";
import { STR, hasLang, pickLang, nextLang, langLabel, langName } from "./strings.js";

const KEY = "control-tower.lang";

// Until the person picks one: the system's language when there is a table for it, else English.
function systemLang() {
  try {
    return pickLang(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return "en";
  }
}

export const lang = () => {
  const picked = shared(KEY);
  return hasLang(picked) ? picked : systemLang();
};
/** The language the button goes to next. */
export const upcomingLang = () => nextLang(lang());
export const setLang = (id) => setShared(KEY, hasLang(id) ? id : "en");
/** A string in a given language, whatever is shown now. */
export const trIn = (language, key) => STR[language]?.[key] ?? STR.en[key] ?? key;
export const tr = (key) => STR[lang()]?.[key] ?? STR.en[key] ?? key;
/** What the language button shows, and its tooltip ("Change language · English → 한국어"). */
export const langButton = () => ({
  label: langLabel(lang()),
  tip: `${tr("lang")} · ${langName(lang())} → ${langName(upcomingLang())}`,
});
