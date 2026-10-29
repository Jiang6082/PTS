import fs from "node:fs/promises";

const roster = JSON.parse(await fs.readFile("inputs/pts_employer_roster.json", "utf8"));
const db = JSON.parse(await fs.readFile("inputs/company_career_pages.json", "utf8"));
const scan = JSON.parse(await fs.readFile("data/pts_roles_scan_v2_raw.json", "utf8"));
let v1 = { companyAudits: [] };
try { v1 = JSON.parse(await fs.readFile("data/pts_scan_audit.json", "utf8")); } catch {}
const v1By = new Map(v1.companyAudits.map((a) => [a.company, a]));

const outputJson = "data/pts_roster_scan_audit.json";
const outputMarkdown = "reports/pts_roster_scan_audit.md";
const nameOf = (entry) => (typeof entry === "string" ? entry : entry.name);
const canonical = (company) => roster.aliases?.[company] || company;
const canonicalCompanies = [...new Set(roster.companies.map(nameOf).map(canonical))];
const categoryOf = new Map(roster.companies.filter((e) => typeof e === "object").map((e) => [canonical(e.name), e.category || ""]));
const noRows = new Set(scan.companiesWithoutRows || []);
const noOpenPostings = new Set(scan.confirmedNoOpenPostings || []);
const noMatchingRoles = new Set(scan.confirmedNoMatchingRoles || []);

function statusFor(company) {
  if (!noRows.has(company)) return "matching-role-found";
  if (noOpenPostings.has(company)) return "confirmed-no-open-postings";
  if (noMatchingRoles.has(company)) return "confirmed-openings-no-matching-role";
  return "could-not-fully-verify";
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|");
}

const pageAudits = scan.careerPageScanAudits || [];
const rows = canonicalCompanies.map((company) => {
  const careerPages = db.companies?.[company]?.careerPages || [];
  const auditedPages = pageAudits.filter((page) => page.company === company);
  return {
    company,
    sourceRosterNames: roster.companies.map(nameOf).filter((name) => canonical(name) === company),
    category: categoryOf.get(company) || "",
    status: statusFor(company),
    careerPages,
    livePages: auditedPages.filter((page) => page.pageOk).length,
    attemptedPages: auditedPages.length,
    jobsSeen: Math.max(v1By.get(company)?.jobsSeen || 0, ...auditedPages.map((page) => page.jobsSeen || 0)),
    relevantRoles: Math.max(v1By.get(company)?.relevantRoles || 0, ...auditedPages.map((page) => page.relevantRoles || 0)),
    liveBoards: (v1By.get(company)?.resolvedBoards || []).map((b) => `${b.source} (${b.count})`),
    failedSeededBoards: v1By.get(company)?.failedSeededBoards || [],
  };
});

const statusOrder = [
  "matching-role-found",
  "confirmed-no-open-postings",
  "confirmed-openings-no-matching-role",
  "could-not-fully-verify",
];
const counts = Object.fromEntries(statusOrder.map((status) => [status, rows.filter((row) => row.status === status).length]));
const audit = {
  generatedAt: new Date().toISOString(),
  scanStartedAt: scan.searchedAt,
  sourceRosterEntries: roster.companies.length,
  canonicalCompanies: canonicalCompanies.length,
  counts,
  companies: rows,
};
await fs.writeFile(outputJson, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

const labels = {
  "matching-role-found": "Matching Roles Found",
  "confirmed-no-open-postings": "Confirmed No Open Postings",
  "confirmed-openings-no-matching-role": "Confirmed Openings, No Matching Role",
  "could-not-fully-verify": "Could Not Fully Verify",
};
const lines = [
  "# PTS Employer Roster Scan Audit",
  "",
  `Scan started: ${scan.searchedAt}`,
  `Source roster entries: ${roster.companies.length}`,
  `Canonical companies after aliases: ${canonicalCompanies.length}`,
  "",
];
for (const status of statusOrder) {
  lines.push(`## ${labels[status]} (${counts[status]})`, "", "| Employer | Category | Live ATS boards (jobs scanned) | Career pages |", "| --- | --- | --- | --- |");
  for (const row of rows.filter((candidate) => candidate.status === status)) {
    const health = row.liveBoards.length ? row.liveBoards.join(", ") : row.attemptedPages ? `${row.livePages}/${row.attemptedPages} pages live` : "none";
    const pages = row.careerPages.length ? row.careerPages.map((url) => `[link](${url})`).join(" ") : "none";
    lines.push(`| ${escapeMarkdown(row.company)} | ${escapeMarkdown(row.category)} | ${escapeMarkdown(health)} | ${pages} |`);
  }
  lines.push("");
}
const failed = rows.filter((row) => row.failedSeededBoards.length);
lines.push(`## Seeded Boards That Failed This Scan (${failed.length} employers)`, "", "These seeds in inputs/ats_seeds.json returned nothing (wrong slug, moved ATS, or a transient error). Prune or fix them after two consecutive failures.", "");
lines.push(...(failed.length ? failed.map((row) => `- **${row.company}**: ${row.failedSeededBoards.join(", ")}`) : ["_None._"]), "");
await fs.writeFile(outputMarkdown, `${lines.join("\n")}\n`, "utf8");

console.log(`roster audit: ${statusOrder.map((status) => `${status}=${counts[status]}`).join(" ")}`);
