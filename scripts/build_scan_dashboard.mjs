import fs from "node:fs/promises";
import { trackOrder } from "../tools/regions.mjs";

const reportPath = "data/new_pts_roles_since_last_run.json";
const rawPath = "data/pts_roles_scan_v2_raw.json";

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

function rowLink(row) {
  return `- **${row.Company}** - [${row.Title}](${row.URL}) - ${row.Location || "Location not listed"}`;
}

function groupedRows(rows = []) {
  const grouped = new Map(trackOrder.map((t) => [t, []]));
  for (const row of rows) {
    const track = row.Track || "Other";
    if (!grouped.has(track)) grouped.set(track, []);
    grouped.get(track).push(row);
  }
  return [...grouped.keys()].flatMap((track) => {
    const list = grouped.get(track) || [];
    return [`### ${track} (${list.length})`, "", list.length ? list.map(rowLink).join("\n") : "_None._", ""];
  });
}

const report = await readJson(reportPath, { generatedAt: new Date().toISOString(), currentScanAt: "unknown", currentRows: 0, added: [], removed: [] });
const raw = await readJson(rawPath, { rows: [], companies: [], careerPageScanTasks: [] });
const audit = await readJson("data/pts_roster_scan_audit.json", { counts: {} });
const counts = audit.counts || {};

const byCategory = {};
for (const row of raw.rows || []) byCategory[row.Category || "Uncategorised"] = (byCategory[row.Category || "Uncategorised"] || 0) + 1;
const partTime = (raw.rows || []).filter((r) => r.Confidence === "part-time").length;

const lines = [
  "# PTS Latest Part-Time Internship Scan",
  "",
  `Last updated: ${report.currentScanAt || report.generatedAt}`,
  "",
  "## Summary",
  "",
  `- Employers searched: ${(raw.companies || []).length || "unknown"}`,
  `- Career pages checked: ${(raw.careerPageScanTasks || []).length || "unknown"}`,
  `- Current roles: ${(raw.rows || []).length} (${partTime} part-time, ${(raw.rows || []).length - partTime} term-time with hours not stated)`,
  `- New stable job URLs since previous scan: ${(report.added || []).length}`,
  `- No longer present since previous scan: ${(report.removed || []).length}`,
  `- Employers with matching roles: ${counts["matching-role-found"] ?? "unknown"}`,
  `- Confirmed no open postings: ${counts["confirmed-no-open-postings"] ?? "unknown"}`,
  `- Openings but no matching role: ${counts["confirmed-openings-no-matching-role"] ?? "unknown"}`,
  `- Could not fully verify: ${counts["could-not-fully-verify"] ?? "unknown"}`,
  "",
  "## Roles By Employer Category",
  "",
  ...(Object.keys(byCategory).length ? Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c}: ${n}`) : ["_None._"]),
  "",
  "## New Roles Since Previous Scan",
  "",
  ...groupedRows(report.added || []),
  "## No Longer Present",
  "",
  (report.removed || []).length ? report.removed.map(rowLink).join("\n") : "_None._",
  "",
  "## Full Reports",
  "",
  "- [Open roles list (title + link)](VERIFIED_OPEN_ROLES.md)",
  "- [Current full list with coverage status](pts_roles_scan_v2.md)",
  "- [New roles since previous scan](new_pts_roles_since_last_run.md)",
  "- [Current roles not in your tracker](current_pts_roles_not_in_tracker.md)",
  "- [Roster verification audit](pts_roster_scan_audit.md)",
  "- [Current full CSV](pts_roles_scan_v2.csv)",
  "",
];
await fs.writeFile("reports/LATEST_PTS_SCAN.md", `${lines.join("\n")}\n`, "utf8");
console.log("wrote reports/LATEST_PTS_SCAN.md");
