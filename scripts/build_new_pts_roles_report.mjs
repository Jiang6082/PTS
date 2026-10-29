import fs from "node:fs/promises";
import { groupedRoleMarkdown, regionForLocation } from "../tools/regions.mjs";
import { cleanTitle, stillRelevant } from "../tools/clean.mjs";
import { loadRoster } from "../tools/firms.mjs";

const { byName } = await loadRoster();

const previousPath = ".scan-state/previous_pts_v2_raw.json";
const currentPath = "data/pts_roles_scan_v2_raw.json";

// Query params that are pure tracking noise and never identify a job posting.
// Everything else (gh_jid, id, jobId, gh_src, ...) is kept, so distinct jobs on
// the same board path stay distinct instead of collapsing to one key.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "source", "src", "trk", "_ga",
]);

function stableUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  }
}

// Looser key that drops the entire query string. Used only for matching against
// the older application tracker, whose entries are sometimes base career-page
// links rather than specific job URLs, so a path-level match is intended there.
function looseUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  }
}

function parseCsv(text = "") {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some(Boolean)) records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  if (!records.length) return [];
  const headers = records[0];
  return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

async function historicalTrackerUrls() {
  const urls = new Set();
  for (const path of ["inputs/internship_tracker.csv"]) {
    try {
      const rows = parseCsv(await fs.readFile(path, "utf8"));
      for (const row of rows) if (row.URL) urls.add(looseUrl(row.URL));
    } catch {}
  }
  return urls;
}

let previous = { searchedAt: "unknown", rows: [] };
try {
  previous = JSON.parse(await fs.readFile(previousPath, "utf8"));
} catch {}
const current = JSON.parse(await fs.readFile(currentPath, "utf8"));
const previousUrls = new Set((previous.rows || []).map((row) => stableUrl(row.URL)));
const currentUrls = new Set((current.rows || []).map((row) => stableUrl(row.URL)));

// --- Stability guard ---------------------------------------------------------
// A role is only reported as newly added once it has appeared in TWO consecutive
// scans, and only reported as closed once it has been absent from TWO consecutive
// scans. This makes a single-scan board hiccup (e.g. a feed transiently returning
// zero jobs) a non-event instead of churning the reports and closure archive.
// State lives in .scan-state (git-ignored, per-machine), like previous_pts_v2_raw.
const stablePath = ".scan-state/stable_roles.json";
const roleMeta = (row) => ({
  Company: row.Company,
  Category: row.Category || "",
  Track: row.Track || "",
  Confidence: row.Confidence || "",
  Department: row.Department || "",
  Notes: row.Notes || "",
  Title: cleanTitle(row.Title),
  Location: row.Location || "",
  Region: row.Region || regionForLocation(row.Location),
  URL: row.URL,
  Source: row.Source || "",
  Status: row.Status || "",
});
const currentByUrl = new Map((current.rows || []).map((row) => [stableUrl(row.URL), row]));

let stable; // Map: stableUrl -> role meta (the confirmed-present set)
try {
  const parsed = JSON.parse(await fs.readFile(stablePath, "utf8"));
  // Drop roles the (possibly tightened) filter no longer keeps, so they leave silently
  // instead of being reported as "closed".
  // Roles still returned by this scan are relevant by definition (only re-check the rest),
  // so a role is never dropped and then re-reported as "new" while it stays open.
  stable = new Map((parsed.roles || [])
    .filter((r) => currentUrls.has(stableUrl(r.URL)) || stillRelevant(r, byName.get(r.Company) || {}))
    .map((r) => [stableUrl(r.URL), { ...r, Title: cleanTitle(r.Title) }]));
} catch {
  stable = null;
}

let added, removed;
if (stable === null) {
  // First run under the guard: seed the confirmed set from the current roles and
  // report nothing, so we don't flag the whole existing list as "new".
  stable = new Map((current.rows || []).map((row) => [stableUrl(row.URL), roleMeta(row)]));
  added = [];
  removed = [];
} else {
  // Confirmed added: present in BOTH this scan and the previous one, not yet stable.
  const confirmedAdded = [...currentUrls].filter((u) => previousUrls.has(u) && !stable.has(u));
  // Confirmed closed: in the stable set but absent from BOTH this and the previous scan.
  const confirmedRemoved = [...stable.keys()].filter((u) => !currentUrls.has(u) && !previousUrls.has(u));
  added = confirmedAdded.map((u) => roleMeta(currentByUrl.get(u)));
  removed = confirmedRemoved.map((u) => stable.get(u));
  for (const u of confirmedAdded) stable.set(u, roleMeta(currentByUrl.get(u)));
  for (const u of confirmedRemoved) stable.delete(u);
}
await fs.writeFile(stablePath, `${JSON.stringify({ updatedAt: current.searchedAt, roles: [...stable.values()] }, null, 2)}\n`, "utf8");

const enrichedAdded = added.map((row) => ({ ...row, Region: row.Region || regionForLocation(row.Location) }));
const trackerUrls = await historicalTrackerUrls();
const notInTracker = (current.rows || []).filter((row) => !trackerUrls.has(looseUrl(row.URL)));

const report = {
  generatedAt: new Date().toISOString(),
  previousScanAt: previous.searchedAt,
  currentScanAt: current.searchedAt,
  previousRows: previous.rows?.length || 0,
  currentRows: current.rows?.length || 0,
  added: enrichedAdded,
  removed,
};
await fs.writeFile("data/new_pts_roles_since_last_run.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = [
  "# New Part-Time Roles Since Last Run",
  "",
  `Previous scan: ${previous.searchedAt}`,
  `Current scan: ${current.searchedAt}`,
  `Previous rows: ${report.previousRows}`,
  `Current rows: ${report.currentRows}`,
  `New stable job URLs: ${added.length}`,
  `No longer present: ${removed.length}`,
  "",
  "## New Roles By Track",
  "",
  ...groupedRoleMarkdown(enrichedAdded),
  "## No Longer Present",
  "",
  removed.length ? removed.map((row) => `- **${row.Company}** - [${row.Title}](${row.URL})`).join("\n") : "_None._",
  "",
].join("\n");
await fs.writeFile("reports/new_pts_roles_since_last_run.md", markdown, "utf8");

// --- Persistent closed/removed-role archive ---
// Each role that disappears between two scans is recorded once (keyed by URL),
// with the last scan that still saw it open and the scan that first saw it gone.
// The true close time lies between those two timestamps.
const closedHistoryPath = "data/closed_roles_history.json";
let closedHistory = [];
try {
  const parsed = JSON.parse(await fs.readFile(closedHistoryPath, "utf8"));
  if (Array.isArray(parsed)) closedHistory = parsed;
} catch {}
const closedByUrl = new Map(closedHistory.map((entry) => [stableUrl(entry.URL), entry]));

// Annotate any previously-closed role that is open again in the current scan.
for (const row of current.rows || []) {
  const entry = closedByUrl.get(stableUrl(row.URL));
  if (entry && !entry.reopenedAt) entry.reopenedAt = current.searchedAt;
}

// Record newly-detected closures (first time we see a given URL disappear).
let newlyClosed = 0;
for (const row of removed) {
  const key = stableUrl(row.URL);
  if (closedByUrl.has(key)) continue;
  const entry = {
    Company: row.Company,
    Track: row.Track || "",
    Title: row.Title,
    Location: row.Location || "",
    Region: row.Region || regionForLocation(row.Location),
    URL: row.URL,
    Source: row.Source || "",
    Status: row.Status || "",
    lastSeenOpenAt: previous.searchedAt,
    detectedClosedAt: current.searchedAt,
  };
  closedHistory.push(entry);
  closedByUrl.set(key, entry);
  newlyClosed += 1;
}

// Most-recently-closed first.
closedHistory.sort((a, b) => String(b.detectedClosedAt).localeCompare(String(a.detectedClosedAt)));
await fs.writeFile(closedHistoryPath, `${JSON.stringify(closedHistory, null, 2)}\n`, "utf8");

const closedByDay = new Map();
for (const entry of closedHistory) {
  const day = String(entry.detectedClosedAt).slice(0, 10) || "unknown";
  if (!closedByDay.has(day)) closedByDay.set(day, []);
  closedByDay.get(day).push(entry);
}
const closedDays = [...closedByDay.keys()].sort((a, b) => b.localeCompare(a));
const closedMarkdown = [
  "# Closed / Removed Roles History",
  "",
  `Total closures recorded: ${closedHistory.length}`,
  `Last updated: ${current.searchedAt}`,
  "",
  "Each role below was present in an earlier scan and absent in a later one. \"Detected closed\" is the first scan that no longer saw the posting; it actually came down sometime between the previous scan and that one. Roles later seen open again are annotated as reopened.",
  "",
  "## Closures By Date Detected",
  "",
  ...closedDays.flatMap((day) => [
    `### ${day} (${closedByDay.get(day).length})`,
    "",
    ...closedByDay.get(day).map((entry) => {
      const loc = entry.Location ? ` - ${entry.Location}` : "";
      const reopened = entry.reopenedAt ? ` — _reopened ${String(entry.reopenedAt).slice(0, 10)}_` : "";
      return `- **${entry.Company}** - [${entry.Title}](${entry.URL})${loc}${reopened}`;
    }),
    "",
  ]),
].join("\n");
await fs.writeFile("reports/closed_roles_history.md", closedMarkdown, "utf8");

const trackerMarkdown = [
  "# Current Part-Time Roles Not In Your Tracker",
  "",
  `Current scan: ${current.searchedAt}`,
  `Historical tracker URLs: ${trackerUrls.size}`,
  `Current roles absent from tracker: ${notInTracker.length}`,
  "",
  "These roles are not in inputs/internship_tracker.csv (add URLs there as you apply). They are not necessarily newly posted.",
  "",
  ...groupedRoleMarkdown(notInTracker),
].join("\n");
await fs.writeFile("reports/current_pts_roles_not_in_tracker.md", trackerMarkdown, "utf8");
await fs.writeFile("data/current_pts_roles_not_in_tracker.json", `${JSON.stringify({
  generatedAt: report.generatedAt,
  currentScanAt: current.searchedAt,
  historicalTrackerUrls: trackerUrls.size,
  roles: notInTracker,
}, null, 2)}\n`, "utf8");

console.log(`new-role report: previous=${report.previousRows} current=${report.currentRows} added=${added.length} removed=${removed.length} notInHistoricalTracker=${notInTracker.length}`);
console.log(`closed-role archive: total=${closedHistory.length} newlyClosed=${newlyClosed}`);
