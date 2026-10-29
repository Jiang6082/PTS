// Builds reports/VERIFIED_OPEN_ROLES.{md,csv}: one clean list of every currently open
// part-time / term-time software, data and finance internship (title + link), combining
//   1. roles confirmed live on an official ATS in the latest scan (part-time first, then
//      term-time roles whose hours are not stated), and
//   2. hand-checked roles and scout programs from inputs/manual_verified_roles.json,
// plus roles that closed in the last 14 days.
import fs from "node:fs/promises";
import { toCsv } from "../tools/common.mjs";
import { trackOrder } from "../tools/regions.mjs";
import { stillRelevant } from "../tools/clean.mjs";
import { loadRoster } from "../tools/firms.mjs";

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

const raw = await readJson("data/pts_roles_scan_v2_raw.json", { rows: [], searchedAt: "" });
const manual = await readJson("inputs/manual_verified_roles.json", { roles: [], programs: [], firmNotes: {} });
const closed = await readJson("data/closed_roles_history.json", []);
const { byName } = await loadRoster();
const scanAt = raw.searchedAt || new Date().toISOString();
const scanDay = scanAt.slice(0, 10);
const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const displayLocation = (loc) => (/^\d+ Locations?$/i.test(String(loc).trim()) ? "Multiple locations" : esc(loc));

const official = (raw.rows || []).filter((r) => /confirmed official/i.test(r.Status || ""));
const leads = (raw.rows || []).filter((r) => !/confirmed official/i.test(r.Status || ""));
const partTime = official.filter((r) => r.Confidence === "part-time");
const unstated = official.filter((r) => r.Confidence !== "part-time");
const liveUrls = new Set((raw.rows || []).map((r) => (r.URL || "").toLowerCase()));
const liveTitles = new Set((raw.rows || []).map((r) => `${r.Company}\n${r.Title}`.toLowerCase()));
const manualRows = (manual.roles || []).filter((m) => !liveUrls.has((m.url || "").toLowerCase()) && !liveTitles.has(`${m.company}\n${m.title}`.toLowerCase()));
const programs = manual.programs || [];

function trackSections(rows) {
  const out = [];
  const tracks = [...trackOrder, ...new Set(rows.map((r) => r.Track).filter((t) => !trackOrder.includes(t)))];
  for (const track of tracks) {
    const list = rows.filter((r) => r.Track === track).sort((a, b) => a.Company.localeCompare(b.Company) || a.Title.localeCompare(b.Title));
    if (!list.length) continue;
    out.push(`### ${track} (${list.length})`, "", "| Employer | Role | Location | Hours / term |", "|---|---|---|---|");
    for (const r of list) {
      const note = manual.firmNotes?.[r.Company] ? ` — _${esc(manual.firmNotes[r.Company])}_` : "";
      out.push(`| ${esc(r.Company)} | [${esc(r.Title)}](${r.URL}) | ${displayLocation(r.Location) || "See posting"} | ${esc(r.Notes)}${note} |`);
    }
    out.push("");
  }
  return out.length ? out : ["_None this scan._", ""];
}

const cutoff = new Date(Date.parse(scanAt) - 14 * 864e5).toISOString();
const closedSeen = new Set();
const recentlyClosed = (Array.isArray(closed) ? closed : [])
  .filter((c) => !c.reopenedAt && String(c.detectedClosedAt) >= cutoff)
  .filter((c) => stillRelevant(c, byName.get(c.Company) || {}))
  .filter((c) => { const k = `${c.Company}\n${c.Title}\n${c.Location}`.toLowerCase(); if (closedSeen.has(k)) return false; closedSeen.add(k); return true; })
  .sort((a, b) => String(b.detectedClosedAt).localeCompare(String(a.detectedClosedAt)));

const employers = new Set(official.map((r) => r.Company));
const lines = [
  "# Open Part-Time Internships (Software · Data · Finance)",
  "",
  `**Last scan:** ${scanAt.replace("T", " ").slice(0, 16)} UTC · **${partTime.length} part-time roles** and **${unstated.length} term-time roles with hours not stated**, confirmed live on official job boards across ${employers.size} employers · **${manualRows.length + programs.length} hand-checked roles / scout programs**`,
  "",
  "Window: now through June 2027 (fall 2026, winter 2027, spring 2027, academic-year). Remote in the US only, except UChicago research-assistant / student roles. Summer-only internships, full-time off-cycle co-ops, senior, PhD/MBA-only, investment-banking and corporate-finance roles are filtered out.",
  "",
  "- **Part-time** = the posting itself says so: a part-time commitment field, \"part-time\" in the title, at most 30 hours/week, or academic-year / while-enrolled wording.",
  "- **Hours not stated** = a student role dated for a fall/winter/spring term inside the window that says nothing about hours either way. Check the posting.",
  "- **Hand-checked** = sites or programs without a machine-readable job board; status as of the date shown.",
  "",
  `## ✅ Part-Time Roles Confirmed Live (${partTime.length})`,
  "",
  ...trackSections(partTime),
  `## 🕒 Term-Time Roles, Hours Not Stated (${unstated.length})`,
  "",
  ...trackSections(unstated),
  `## 🟡 Hand-Checked Roles (${manualRows.length})`,
  "",
];
if (manualRows.length) {
  lines.push("| Employer | Role | Location | Status | Checked | Notes |", "|---|---|---|---|---|---|");
  for (const m of manualRows) lines.push(`| ${esc(m.company)} | [${esc(m.title)}](${m.url}) | ${esc(m.location)} | ${esc(m.status)} | ${m.checkedAt} | ${esc(m.note)} |`);
} else lines.push("_None._");
lines.push("", `## 🧭 VC Scout & Student Venture Programs (${programs.length})`, "", "Application-form programs (no job board). Windows change every year, so confirm on the program page.", "");
if (programs.length) {
  lines.push("| Program | Who | Status | Checked | Notes |", "|---|---|---|---|---|");
  for (const p of programs) lines.push(`| [${esc(p.name)}](${p.url}) | ${esc(p.who)} | ${esc(p.status)} | ${p.checkedAt} | ${esc(p.note)} |`);
} else lines.push("_None._");
lines.push("");
if (leads.length) {
  lines.push(`## 🔎 Web-Discovered Leads — Verify Before Applying (${leads.length})`, "", "| Employer | Role | Track | Source |", "|---|---|---|---|");
  for (const r of leads) lines.push(`| ${esc(r.Company)} | [${esc(r.Title)}](${r.URL}) | ${esc(r.Track)} | ${esc(r.Status)} |`);
  lines.push("");
}
lines.push(`## ⛔ Closed In The Last 14 Days (${recentlyClosed.length})`, "");
lines.push(recentlyClosed.length
  ? ["| Employer | Role | Detected closed |", "|---|---|---|", ...recentlyClosed.map((c) => `| ${esc(c.Company)} | [${esc(c.Title)}](${c.URL}) | ${String(c.detectedClosedAt).slice(0, 10)} |`)].join("\n")
  : "_None._");
lines.push("", `_Generated by PTS on ${scanDay}. Full detail: [pts_roles_scan_v2.md](pts_roles_scan_v2.md) · [CSV](VERIFIED_OPEN_ROLES.csv)_`, "");
await fs.writeFile("reports/VERIFIED_OPEN_ROLES.md", lines.join("\n"), "utf8");

const csvRows = [
  ...partTime.map((r) => ({ Status: "Part-time, confirmed live (official ATS)", Track: r.Track, Company: r.Company, Title: r.Title, URL: r.URL, Location: r.Location, Checked: scanDay, Notes: r.Notes })),
  ...unstated.map((r) => ({ Status: "Term-time, hours not stated (official ATS)", Track: r.Track, Company: r.Company, Title: r.Title, URL: r.URL, Location: r.Location, Checked: scanDay, Notes: r.Notes })),
  ...manualRows.map((m) => ({ Status: `Hand-checked: ${m.status}`, Track: m.track || "", Company: m.company, Title: m.title, URL: m.url, Location: m.location, Checked: m.checkedAt, Notes: m.note })),
  ...programs.map((p) => ({ Status: `Program: ${p.status}`, Track: "VC Scout", Company: p.name, Title: p.who, URL: p.url, Location: "", Checked: p.checkedAt, Notes: p.note })),
  ...leads.map((r) => ({ Status: r.Status, Track: r.Track, Company: r.Company, Title: r.Title, URL: r.URL, Location: r.Location, Checked: scanDay, Notes: "" })),
];
await fs.writeFile("reports/VERIFIED_OPEN_ROLES.csv", toCsv(csvRows, ["Status", "Track", "Company", "Title", "URL", "Location", "Checked", "Notes"]), "utf8");
console.log(`verified roles: partTime=${partTime.length} hoursNotStated=${unstated.length} handChecked=${manualRows.length} programs=${programs.length} leads=${leads.length} recentlyClosed=${recentlyClosed.length}`);
