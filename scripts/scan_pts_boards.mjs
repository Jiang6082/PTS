// PTS v1 scan: enumerate every known / guessable ATS board for the employer universe and
// keep part-time / term-time software, data and finance internships (Oct 2026 - Jun 2027).
//
//   inputs/pts_employer_roster.json -> employer universe (+ scope / kind / localOk)
//   inputs/ats_seeds.json           -> ATS boards per employer
//   + guessed Greenhouse / Lever / Ashby slugs from the employer name
//
// Candidate postings (student / intern / part-time titles) get one detail fetch for their
// description + schedule fields before classification (tools/enrich.mjs).
//
// Writes reports/pts_roles_scan.{csv,md} and data/pts_scan_{raw,audit}.json
import fs from "node:fs/promises";
import { fetchJson, mapLimit, toCsv } from "../tools/common.mjs";
import { ashby, collectorTasks, greenhouse, lever, seedKey } from "../tools/collectors.mjs";
import { enrichCandidates } from "../tools/enrich.mjs";
import { generatedTokens, loadRoster, loadSeeds } from "../tools/firms.mjs";
import { classifyRole, roleNote } from "../tools/relevance.mjs";

const { firms } = await loadRoster();
const seeds = await loadSeeds();
const ROW_HEADERS = ["Company", "Category", "Track", "Confidence", "Title", "Department", "Location", "Commitment", "Workplace", "URL", "Source", "PostedAt", "Notes"];

function normalizeName(value = "") {
  return value.toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

// A guessed board only counts if its display name resembles the employer.
async function greenhouseBoardMatches(firm, token) {
  const meta = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}`);
  if (!meta?.name) return false;
  const board = normalizeName(meta.name).replace(/\s+/g, "");
  const words = normalizeName(firm.name).split(" ").filter((w) => w.length > 2 && !["the", "and", "group", "capital", "partners", "ventures", "labs", "technologies", "inc"].includes(w));
  return words.some((w) => board.includes(w));
}
const guessedJobsMatch = (firm, jobs) => {
  // Lever/Ashby boards have no display name; require the employer name or domain somewhere in the postings.
  const words = normalizeName(firm.name).split(" ").filter((w) => w.length > 3);
  const host = String(firm.domain || "").split(".")[0];
  if (!jobs.length) return false;
  const text = jobs.slice(0, 15).map((j) => `${j.Content} ${j.URL}`).join(" ").toLowerCase();
  return words.some((w) => text.includes(w)) || (host.length > 3 && text.includes(host));
};

async function scanFirm(firm) {
  const firmSeeds = seeds[firm.name] || {};
  const tasks = collectorTasks(firm.name, firmSeeds).map((t) => ({ ...t, origin: "seeded" }));
  const seededKeys = new Set(tasks.map((t) => seedKey(t.key, t.value)));
  for (const token of generatedTokens(firm.name)) {
    if (!seededKeys.has(seedKey("greenhouse", token))) {
      tasks.push({ key: "greenhouse", value: token, origin: "guessed", run: async () => ((await greenhouseBoardMatches(firm, token)) ? greenhouse(firm.name, token) : null) });
    }
    if (!seededKeys.has(seedKey("lever", token))) tasks.push({ key: "lever", value: token, origin: "guessed", run: async () => { const b = await lever(firm.name, token); return b && guessedJobsMatch(firm, b.jobs) ? b : null; } });
    if (!seededKeys.has(seedKey("ashby", token))) tasks.push({ key: "ashby", value: token, origin: "guessed", run: async () => { const b = await ashby(firm.name, token); return b && guessedJobsMatch(firm, b.jobs) ? b : null; } });
  }

  const outcomes = await Promise.all(tasks.map((task) => task.run().catch(() => null)));
  const boards = [];
  outcomes.forEach((result, i) => {
    const task = tasks[i];
    if (result) boards.push({ ...result, origin: task.origin, seed: { key: task.key, value: task.value } });
    else if (task.origin === "seeded") boards.push({ source: `${task.key}:${typeof task.value === "string" ? task.value : `${task.value.host}/${task.value.site || task.value.domain}`}`, jobs: null, origin: "seeded", failed: true, seed: { key: task.key, value: task.value } });
  });

  const seen = new Set();
  const unique = [];
  for (const board of boards.filter((b) => b.jobs)) {
    for (const j of board.jobs) {
      if (!j.URL || seen.has(j.URL)) continue;
      seen.add(j.URL);
      unique.push(j);
    }
  }
  const enriched = await enrichCandidates(unique, { limit: 6, label: `${firm.name} details` });
  const matches = [];
  const rejected = {};
  for (const j of enriched) {
    const verdict = classifyRole({ ...j, Notes: "" }, firm);
    if (!verdict.track) { rejected[verdict.reason] = (rejected[verdict.reason] || 0) + 1; continue; }
    matches.push({
      Company: firm.name,
      Category: firm.category,
      Track: verdict.track,
      Confidence: verdict.confidence,
      Title: j.Title,
      Department: j.Department,
      Location: j.Location,
      Commitment: j.Commitment,
      Workplace: j.Workplace || (verdict.mode === "remote" ? "remote" : ""),
      URL: j.URL,
      Source: `Official ATS ${j.Source}`,
      PostedAt: j.PostedAt,
      Notes: roleNote(verdict),
    });
  }
  return {
    company: firm.name,
    category: firm.category,
    boards: boards.map((b) => ({ source: b.source, origin: b.origin, ok: !b.failed, count: b.jobs ? b.jobs.length : 0, seed: b.seed })),
    jobsSeen: unique.length,
    seenUrls: unique.map((j) => j.URL),
    rejected,
    matches,
  };
}

const scannedAt = new Date().toISOString();
const results = await mapLimit(firms, 8, scanFirm, "employers scanned");

// The same job is often published on several boards/sites of one employer. Keep one per
// employer/title/location, sorting by URL first so the kept copy is stable between scans.
const byUrl = new Map();
const seenIdentity = new Set();
for (const m of results.flatMap((r) => r.matches).sort((a, b) => a.URL.localeCompare(b.URL))) {
  const id = `${m.Company}\n${m.Title}\n${m.Location}`.toLowerCase();
  if (byUrl.has(m.URL) || seenIdentity.has(id)) continue;
  seenIdentity.add(id);
  byUrl.set(m.URL, m);
}
const matches = [...byUrl.values()].sort((a, b) => a.Company.localeCompare(b.Company) || a.Title.localeCompare(b.Title));
const confirmed = matches.filter((m) => m.Confidence === "part-time");
const unstated = matches.filter((m) => m.Confidence !== "part-time");

await fs.mkdir("reports", { recursive: true });
await fs.mkdir("data", { recursive: true });
await fs.writeFile("reports/pts_roles_scan.csv", toCsv(matches, ROW_HEADERS), "utf8");

const line = (m) => `- **${m.Company}** — [${m.Title}](${m.URL}) — ${m.Location || "Location not listed"} (${m.Track}; ${m.Notes})`;
const withBoards = results.filter((r) => r.boards.some((b) => b.ok));
const md = [
  "# Part-Time Internship Scan (v1: ATS boards)",
  "",
  `Scanned: ${scannedAt}`,
  `Employers in universe: ${firms.length}`,
  `Employers with at least one live ATS board: ${withBoards.length}`,
  `Part-time roles: ${confirmed.length}`,
  `Term-time roles, hours not stated: ${unstated.length}`,
  "",
  "Criteria: open posting on an official ATS board; intern / student / co-op / fellow / scout / research-assistant role; software, data or finance (asset management, hedge funds, research, PE/VC, fintech) work; part-time signal (commitment field, title, <=30 hrs/week, academic-year or while-enrolled wording) or a fall/winter/spring term inside Oct 2026 - Jun 2027 with no full-time statement; remote in the US (UChicago roles may be on campus). Excludes summer-only, full-time off-cycle co-ops, senior, PhD/MBA-only, investment banking / corporate finance, and roles dated outside the window.",
  "",
  "## Part-Time Roles",
  "",
  confirmed.length ? confirmed.map(line).join("\n") : "_None found by the ATS scan._",
  "",
  "## Term-Time Roles, Hours Not Stated",
  "",
  unstated.length ? unstated.map(line).join("\n") : "_None._",
  "",
  "## Employers Without A Live ATS Board (v1)",
  "",
  results.filter((r) => !r.boards.some((b) => b.ok)).map((r) => `- ${r.company}`).join("\n") || "_None._",
  "",
].join("\n");
await fs.writeFile("reports/pts_roles_scan.md", md, "utf8");
// Every posting URL seen on a live board (matching or not). The new/closed report uses it to
// tell "posting closed" apart from "posting still up but no longer passes the filter".
await fs.mkdir(".scan-state", { recursive: true });
await fs.writeFile(".scan-state/seen_urls_v1.json", JSON.stringify(results.flatMap((r) => r.seenUrls)), "utf8");
for (const r of results) delete r.seenUrls;
await fs.writeFile("data/pts_scan_raw.json", JSON.stringify({ scannedAt, results }, null, 2), "utf8");
await fs.writeFile("data/pts_scan_audit.json", JSON.stringify({
  scannedAt,
  companies: firms.map((f) => f.name),
  companyAudits: results.map((r) => ({
    company: r.company,
    category: r.category,
    resolvedBoards: r.boards.filter((b) => b.ok).map(({ source, origin, count }) => ({ source, origin, count })),
    failedSeededBoards: r.boards.filter((b) => !b.ok).map((b) => b.source),
    jobsSeen: r.jobsSeen,
    relevantRoles: r.matches.length,
    rejectedByReason: r.rejected,
  })),
}, null, 2), "utf8");

console.log(`employers=${firms.length} liveBoards=${withBoards.length} partTime=${confirmed.length} hoursNotStated=${unstated.length}`);
console.log("wrote pts_roles_scan.csv, pts_roles_scan.md, pts_scan_raw.json, pts_scan_audit.json");
