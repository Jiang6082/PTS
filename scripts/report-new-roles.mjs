// Stateless "what opened recently" reporter.
//
// Reads the current scan outputs and re-derives each role's release date from the
// PostedAt captured from the source ATS (Greenhouse first_published, Lever createdAt,
// Ashby publishedAt, Workable published, SmartRecruiters releasedDate, Oracle PostedDate)
// or, for Workday, the relative "Posted N Days Ago" string anchored to the scan time.
//   node scripts/report-new-roles.mjs --days=3
//   node scripts/report-new-roles.mjs --since=2026-09-01
import fs from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split("=")[1] : d; };
const days = Number(arg("days", "1"));
const since = arg("since", new Date(Date.now() - days * 864e5).toISOString().slice(0, 10));
const until = arg("until", new Date().toISOString().slice(0, 10));

let raw = { rows: [], entryLevelRows: [] };
try { raw = JSON.parse(fs.readFileSync("data/pts_roles_scan_v2_raw.json", "utf8")); } catch {}
const scanAt = raw.searchedAt;

function releaseDate(row) {
  const p = String(row.PostedAt || "");
  const rel = p.match(/Posted\s+(Today|Yesterday|(\d+)\+?\s+Days?\s+Ago)/i);
  if (/30\+\s*Days/i.test(p)) return null; // Workday floor: older than the window by definition
  if (rel && scanAt) {
    const base = new Date(scanAt);
    base.setUTCDate(base.getUTCDate() - (/Today/i.test(rel[1]) ? 0 : /Yesterday/i.test(rel[1]) ? 1 : Number(rel[2])));
    return base.toISOString().slice(0, 10);
  }
  const d = new Date(/^\d{10,13}$/.test(p) ? Number(p) : p);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const rows = raw.rows || [];
const released = rows.map((r) => ({ ...r, date: releaseDate(r) })).filter((r) => r.date && r.date >= since && r.date <= until)
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.Company.localeCompare(b.Company)));
const byco = {};
for (const r of released) (byco[r.Company] ||= []).push(r);
let out = `# Part-time roles released ${since} → ${until} (${released.length} with known release dates)\n`;
for (const [co, list] of Object.entries(byco).sort((a, b) => b[1].length - a[1].length)) {
  out += `\n## ${co} (${list.length})\n`;
  for (const r of list) out += `- **${r.date}** — [${r.Title}](${r.URL}) — ${r.Location || "n/a"}\n`;
}
process.stdout.write(out);
