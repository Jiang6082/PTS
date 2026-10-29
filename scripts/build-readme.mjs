// Regenerates README.md from the latest scan outputs. Wired into the scan pipeline
// (run-pts-scan.mjs) so the README refreshes on every v2/all run, on any machine.
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { trackOrder } from "../tools/regions.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(repo, p), "utf8")); } catch { return fallback; } };

const raw = readJson("data/pts_roles_scan_v2_raw.json", null);
const hasScan = Boolean(raw);
const roles = raw?.rows || [];
const newData = readJson("data/new_pts_roles_since_last_run.json", { added: [] });
const closed = readJson("data/closed_roles_history.json", []);
const roster = readJson("inputs/pts_employer_roster.json", { companies: [], categories: [] });
const manual = readJson("inputs/manual_verified_roles.json", { roles: [], programs: [] });
const closedCount = Array.isArray(closed) ? closed.length : 0;
const added = newData.added || [];
const firmCount = (raw?.companies || []).length || roster.companies.length;
const scanDate = String(raw?.searchedAt || newData.currentScanAt || new Date().toISOString()).slice(0, 10);
const partTime = roles.filter((r) => r.Confidence === "part-time");
const unstated = roles.filter((r) => r.Confidence !== "part-time");

const esc = (s) => String(s || "").replace(/\|/g, "\\|");
function roleLine(role) {
  const loc = role.Location ? ` — ${esc(role.Location)}` : "";
  const verify = /verify/i.test(role.Status || "") ? " _(verify)_" : "";
  const hours = role.Confidence === "part-time" ? "" : " _(hours not stated)_";
  return `- **${esc(role.Company)}** — [${esc(role.Title)}](${role.URL})${loc}${hours}${verify}`;
}
function byTrack(list) {
  const out = new Map(trackOrder.map((t) => [t, []]));
  for (const r of list) { if (!out.has(r.Track)) out.set(r.Track, []); out.get(r.Track).push(r); }
  return [...out.entries()].filter(([, l]) => l.length);
}
const sortRoles = (a, b) => a.Company.localeCompare(b.Company) || a.Title.localeCompare(b.Title);

let out = "";
out += "# PTS — Part-Time Internship Scanner\n\n";
out += "Automated daily scan for **part-time / term-time internships** in **software engineering, data (data science, analytics, ML, data engineering) and finance (asset management, hedge funds, investment research, PE/VC, fintech)** that run between now and **June 2027**: fall 2026, winter and spring 2027, academic-year and remote part-time roles, plus VC scout programs and UChicago research-assistant / student roles. ";
out += `Covers a **${firmCount}-employer universe** (big tech, AI/data companies, startups, fintech, asset managers, hedge funds, PE/VC, banks, Chicago-area and remote-first employers). Sister project of [QJS](https://github.com/Jiang6082/QJS) and [ECS](https://github.com/Jiang6082/ECS).\n\n`;
out += "**Filter settings:** remote (US) only, except UChicago on-campus roles · any part-time hours, but no full-time off-cycle co-ops · summer-only internships excluded · senior / PhD / MBA-only excluded · investment banking and corporate finance excluded.\n\n";
if (!hasScan) out += "> **No scan has been run yet.** Trigger the GitHub Action (edit `.github/scan-request`) or run `npm run scan:all` to populate the lists below.\n\n";
else out += `> **Last scan:** ${scanDate} &nbsp;•&nbsp; **${partTime.length} part-time roles** &nbsp;•&nbsp; **${unstated.length} term-time, hours not stated** &nbsp;•&nbsp; **${added.length} new**${closedCount ? ` &nbsp;•&nbsp; **${closedCount} closed** ([history](reports/closed_roles_history.md))` : ""}\n\n`;
out += "> ✅ **[Open roles list](reports/VERIFIED_OPEN_ROLES.md)** — every currently open role with title + link, refreshed each scan ([CSV](reports/VERIFIED_OPEN_ROLES.csv)).\n\n";
out += "**Jump to:** [🆕 New Roles](#-new-roles) · [📋 All Roles](#-all-roles) · [How It Works](#how-it-works) · [How to Run](#how-to-run)\n\n---\n\n";

out += "## 🆕 New Roles\n\n";
out += `_Scan date: ${scanDate}_\n\n`;
if (!added.length) out += "_No new roles detected in the latest scan._\n\n";
else {
  out += `**${added.length}** new stable posting${added.length === 1 ? "" : "s"} (seen in two consecutive scans):\n\n`;
  for (const [track, list] of byTrack(added)) out += `**${track}**\n\n${list.sort(sortRoles).map(roleLine).join("\n")}\n\n`;
}
out += "---\n\n## 📋 All Roles\n\n";
out += `**${roles.length}** open roles, grouped by track. Rows marked _(hours not stated)_ are term-time roles that don't say whether they are part-time; _(verify)_ rows are web-discovered leads.\n\n`;
for (const [track, list] of byTrack(roles)) {
  out += `### ${track}\n\n<details>\n<summary><strong>${list.length} role${list.length === 1 ? "" : "s"}</strong> — click to expand</summary>\n\n`;
  out += `${list.sort((a, b) => (a.Confidence === b.Confidence ? 0 : a.Confidence === "part-time" ? -1 : 1) || sortRoles(a, b)).map(roleLine).join("\n")}\n\n</details>\n\n`;
}
if ((manual.programs || []).length) out += `**VC scout programs:** ${(manual.programs || []).length} hand-checked programs are listed in [VERIFIED_OPEN_ROLES.md](reports/VERIFIED_OPEN_ROLES.md#-vc-scout--student-venture-programs-${(manual.programs || []).length}).\n\n`;
out += "---\n\n";

const byCat = {};
for (const c of roster.companies) (byCat[c.category || "Other"] ||= []).push(c.name);
out += "## Employer Universe\n\n";
out += `${roster.companies.length} employers across ${Object.keys(byCat).length} categories. Edit [inputs/pts_employer_roster.json](inputs/pts_employer_roster.json) to add more.\n\n`;
for (const cat of (roster.categories || Object.keys(byCat)).filter((c) => byCat[c])) {
  out += `<details>\n<summary><strong>${cat}</strong> (${byCat[cat].length})</summary>\n\n${byCat[cat].slice().sort((a, b) => a.localeCompare(b)).join(" · ")}\n\n</details>\n\n`;
}
out += "---\n\n";

out += "## How It Works\n\n";
out += "1. **v1 — ATS boards** (`scripts/scan_pts_boards.mjs`): every seeded board in [inputs/ats_seeds.json](inputs/ats_seeds.json) (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, iCIMS, Oracle, Eightfold, Amazon, …) plus guessed Greenhouse/Lever/Ashby slugs. Workday sites are searched for `intern`, `part time` and `student` instead of being fully enumerated.\n";
out += "2. **Detail enrichment** (`tools/enrich.mjs`): postings with student / intern / part-time titles get one detail fetch (Workday job API, SmartRecruiters/Workable/Oracle detail APIs, or the posting's schema.org JSON-LD), because the part-time signal usually lives in the description or a schedule field.\n";
out += "3. **Filter** (`tools/relevance.mjs`): student role → software / data / finance track → date window (now to June 2027; summer-only, past terms and roles running past June 2027 dropped) → remote in the US → part-time signal (commitment field, title, ≤30 hrs/week, academic-year or while-enrolled wording). Term-time roles that say nothing about hours are kept in a separate _hours not stated_ list.\n";
out += "4. **v2 — career pages and web leads** (`scripts/expand_pts_search.mjs`): career pages (auto-discovered via Bing) are scanned for embedded ATS boards; employers with no enumerable source get a web-lead search.\n";
out += "5. **Reports**: two-scan stability guard for new/closed roles, closed-role archive, roster audit (incl. seeded boards that failed), dashboard, this README.\n\n";

out += "## How to Run\n\n";
out += "Requires **Node.js 18+** (no dependencies).\n\n```bash\nnpm run scan:all          # full workflow (v1 + v2 + reports + README)\nnpm run scan:all:publish  # scan, rebuild reports, commit, push\nnpm run report:new -- --days=3   # roles released in the last 3 days (by ATS publish date)\nnpm test                  # offline self-test (stubbed fetch)\n```\n\n";
out += "### Scheduled and on-demand scans (GitHub Actions)\n\n";
out += "[.github/workflows/scan.yml](.github/workflows/scan.yml) runs `npm run scan:all:publish` daily at 13:00 UTC, on manual dispatch, and **on any push that changes [.github/scan-request](.github/scan-request)** — edit the timestamp in that file to start a scan without the Actions tab. `.scan-state/` is cached between runs so new/closed detection keeps working.\n\n";
out += "## Repo Layout\n\n";
out += "| File | What it is |\n|------|-----------|\n";
out += "| [reports/VERIFIED_OPEN_ROLES.md](reports/VERIFIED_OPEN_ROLES.md) | Clean list of open roles (title + link) by track, plus scout programs |\n";
out += "| [reports/LATEST_PTS_SCAN.md](reports/LATEST_PTS_SCAN.md) | Latest scan summary + newest roles |\n";
out += "| [reports/pts_roles_scan_v2.md](reports/pts_roles_scan_v2.md) / [.csv](reports/pts_roles_scan_v2.csv) | Full current list with per-employer coverage status |\n";
out += "| [reports/new_pts_roles_since_last_run.md](reports/new_pts_roles_since_last_run.md) | New stable job URLs |\n";
out += `| [reports/closed_roles_history.md](reports/closed_roles_history.md) | Archive of roles that closed (${closedCount} so far) |\n`;
out += "| [reports/current_pts_roles_not_in_tracker.md](reports/current_pts_roles_not_in_tracker.md) | Current roles absent from your application tracker |\n";
out += "| [reports/pts_roster_scan_audit.md](reports/pts_roster_scan_audit.md) | Every employer's coverage state, live boards, and failed seeds |\n";
out += "| [inputs/pts_employer_roster.json](inputs/pts_employer_roster.json) | Employer universe: category, scope regex, `kind` (vc / uchicago), `localOk` |\n";
out += "| [inputs/ats_seeds.json](inputs/ats_seeds.json) | ATS boards per employer, with provenance (verified-live / web search / candidate) |\n";
out += "| [inputs/manual_verified_roles.json](inputs/manual_verified_roles.json) | Hand-checked roles and VC scout programs |\n";
out += "| [inputs/internship_tracker.csv](inputs/internship_tracker.csv) | Your applications — add URLs to hide them from the not-in-tracker report |\n";
out += "| [custom-ats-watch/](custom-ats-watch/) | Employers with custom portals (Google, Meta, Apple, Citadel, Two Sigma, Goldman, …) |\n\n";
out += "### Changing the filter\n\n";
out += "Window end, hour cap and patterns live at the top of [tools/relevance.mjs](tools/relevance.mjs) (`WINDOW_END`, `MAX_PART_TIME_HOURS`). To allow in-person roles for an employer, set `\"localOk\": true` on its roster entry (only UChicago and NORC have it now). After editing, run `npm test`.\n";

fs.writeFileSync(path.join(repo, "README.md"), out);
console.log(`wrote README.md (roles=${roles.length}, partTime=${partTime.length}, new=${added.length}, closed=${closedCount})`);
