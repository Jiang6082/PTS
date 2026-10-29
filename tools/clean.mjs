// Shared title/row cleanup used by the scanners and by the one-off output migration.
import { decodeHtml } from "./common.mjs";
import { classifyRole } from "./relevance.mjs";

export function cleanTitle(title = "") {
  return decodeHtml(title).replace(/^(?:Job\s+)?(?:Posting\s+)?Title\s+/i, "").trim();
}

// True when a previously-recorded role would still be kept by the current filter's
// title-level rules (function, seniority, domain, dated term, scope). Body-level evidence
// (hours, remote wording) is not stored with old rows, so it is not re-checked here; a
// role that fails this check leaves the stable set silently instead of being "closed".
export function stillRelevant(row, firm = {}) {
  return Boolean(classifyRole({ Title: cleanTitle(row.Title), Department: row.Department || "", Notes: row.Notes || "" }, firm, { titleOnly: true }).track);
}
