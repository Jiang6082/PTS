// PTS v2 scan: saved career pages -> embedded ATS boards, browser-audited custom-ATS
// snapshots, and web-discovered leads, merged on top of the v1 ATS scan.
import fs from "node:fs/promises";
import { decodeHtml, fetchText, hostOf, mapLimit, parseCsv, stripHtml, toCsv } from "../tools/common.mjs";
import { collectorTasks, seedKey } from "../tools/collectors.mjs";
import { detectUnsupportedAts, extractAtsTokens } from "../tools/ats-detect.mjs";
import { enrichCandidates } from "../tools/enrich.mjs";
import { isKnownWrongCareerPage } from "../tools/career-source-guards.mjs";
import { loadRoster, loadSeeds } from "../tools/firms.mjs";
import { classifyRole, roleNote } from "../tools/relevance.mjs";
import { groupedRoleMarkdown, regionForLocation } from "../tools/regions.mjs";

const careerPageDbPath = "inputs/company_career_pages.json";
const baseCsvPath = "reports/pts_roles_scan.csv";
const watchlistPath = "custom-ats-watch/watchlist.json";
const skipWeb = process.argv.includes("--no-web") || process.env.PTS_NO_WEB === "1";

const { firms, byName } = await loadRoster();
const seeds = await loadSeeds();
const companies = firms.map((f) => f.name);

const aggregatorHosts = /(?:linkedin|indeed|glassdoor|ziprecruiter|levels\.fyi|builtin|simplify|tealhq|handshake|joinhandshake|wayup|prosple|jobright|talent\.com|jooble|careerjet|adzuna|reddit|crunchbase|zoominfo|facebook|instagram|wallstreetoasis|vault\.com|efinancialcareers|brightnetwork|targetjobs|gradcracker|gradconnection|ratemyplacement|trackr|youtube|wikipedia|superscout|remoterocketship|wellfound|ycombinator|otta|welcometothejungle)\./i;
const trustedAtsHosts = /(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|workable\.com|personio\.(?:de|com)|teamtailor\.com|pinpointhq\.com|smartrecruiters\.com|paylocity\.com|applytojob\.com|breezy\.hr|oraclecloud\.com|hire\.trakstar\.com|eightfold\.ai|amazon\.jobs)$/i;

// ---------- helpers ----------
function firmTokens(company) {
  return company.toLowerCase().replace(/\(.*?\)/g, " ").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((t) => t.length > 2 && !["the", "and", "group", "capital", "partners", "ventures", "labs", "technologies", "research", "advisors", "global", "international", "management", "investments", "trading"].includes(t));
}

function isOfficialUrl(company, url) {
  const host = hostOf(url);
  const firm = byName.get(company);
  if (firm?.domain && (host === firm.domain || host.endsWith(`.${firm.domain}`))) return true;
  if (trustedAtsHosts.test(host)) return true;
  return false;
}

async function searchBing(query) {
  if (skipWeb) return [];
  const res = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US`);
  if (!res.ok) return [];
  const hits = [];
  for (const block of res.text.split('<li class="b_algo"').slice(1, 11)) {
    const h2 = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h2) continue;
    let url = decodeHtml(h2[1]);
    if (url.includes("/ck/a?")) {
      try {
        const u = new URL(url).searchParams.get("u");
        if (u?.startsWith("a1")) url = Buffer.from(u.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch {}
    }
    hits.push({ url, title: stripHtml(h2[2]), snippet: stripHtml(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "") });
  }
  return hits;
}

// ---------- career page database ----------
async function loadCareerPageDb() {
  try { return JSON.parse(await fs.readFile(careerPageDbPath, "utf8")); } catch { return { generatedAt: "", companies: {} }; }
}

function looksLikeCareerPage(company, hit) {
  if (aggregatorHosts.test(hit.url) || isKnownWrongCareerPage(company, hit.url)) return false;
  const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
  if (!/\b(career|careers|jobs|join|vacancies|opportunities|students|university|internships?|open positions|open roles|work with us|scouts?|fellows?)\b/.test(text)) return false;
  const host = hostOf(hit.url);
  if (isOfficialUrl(company, hit.url) && !trustedAtsHosts.test(host)) return true;
  return firmTokens(company).some((t) => host.replace(/[^a-z0-9]/g, "").includes(t) || (trustedAtsHosts.test(host) && hit.url.toLowerCase().includes(t)));
}

async function discoverCareerPages(company) {
  const pages = new Set();
  for (const q of [`"${company}" careers`, `"${company}" internship careers students`]) {
    for (const hit of await searchBing(q)) {
      if (looksLikeCareerPage(company, hit)) pages.add(hit.url.split("#")[0]);
      if (pages.size >= 3) break;
    }
    if (pages.size >= 3) break;
  }
  return [...pages];
}

async function ensureCareerPageDb() {
  const db = await loadCareerPageDb();
  db.companies ||= {};
  const now = new Date().toISOString();
  const needs = companies.filter((c) => !(db.companies[c]?.careerPages || []).length);
  const found = await mapLimit(needs, 6, async (c) => ({ c, pages: await discoverCareerPages(c) }), "career-page discovery");
  for (const c of companies) {
    const existing = (db.companies[c]?.careerPages || []).filter((u) => !isKnownWrongCareerPage(c, u));
    const discovered = found.find((f) => f.c === c)?.pages || [];
    db.companies[c] = { ...(db.companies[c] || {}), careerPages: [...new Set([...existing, ...discovered])], updatedAt: db.companies[c]?.updatedAt || now };
    if (discovered.length) db.companies[c].updatedAt = now;
  }
  db.generatedAt = now;
  await fs.writeFile(careerPageDbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  return db;
}

function scriptUrls(html, pageUrl) {
  const urls = [...html.matchAll(/<(?:script|iframe)[^>]+src=["']([^"']+)["']/gi)].map((m) => {
    try { return new URL(decodeHtml(m[1]), pageUrl).toString(); } catch { return ""; }
  }).filter(Boolean);
  const pageHost = hostOf(pageUrl);
  const jobby = urls.filter((u) => /(jobs?|careers?|greenhouse|lever|ashby|workday|icims|workable|personio|teamtailor|pinpoint|paylocity|smartrecruiters|recruit)/i.test(u));
  const same = urls.filter((u) => !jobby.includes(u) && hostOf(u) === pageHost).slice(0, 6);
  return [...new Set([...jobby, ...same])].slice(0, 12);
}

// ---------- scan one saved career page ----------
async function scanCareerPage(company, pageUrl) {
  const firm = byName.get(company);
  const page = await fetchText(pageUrl);
  let searchable = `${pageUrl}\n${page.url}\n${page.text}`;
  if (page.ok) {
    for (const s of scriptUrls(page.text, page.url)) {
      const r = await fetchText(s, { timeoutMs: 10000 });
      if (r.ok) searchable += `\n${r.url}\n${r.text.slice(0, 400000)}`;
    }
    // Follow one level of obvious "open roles / students" links on the same site.
    const links = [...page.text.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => { try { return { url: new URL(decodeHtml(m[1]), page.url).toString(), text: stripHtml(m[2]) }; } catch { return null; } })
      .filter((l) => l && /(open (?:roles|positions)|current (?:openings|opportunities|vacancies)|job (?:openings|search)|search jobs|view (?:all )?(?:jobs|openings|roles)|apply now|internships?|students?|campus|early careers)/i.test(l.text))
      .filter((l) => hostOf(l.url) === hostOf(page.url) || trustedAtsHosts.test(hostOf(l.url)))
      .slice(0, 3);
    for (const l of links) {
      const r = await fetchText(l.url, { timeoutMs: 10000 });
      if (r.ok) searchable += `\n${r.url}\n${r.text.slice(0, 400000)}`;
    }
  }
  const discovered = extractAtsTokens(searchable);
  const unsupportedAts = detectUnsupportedAts(searchable);
  const seededKeys = new Set(Object.entries(seeds[company] || {}).flatMap(([k, vs]) => vs.map((v) => seedKey(k, v))));
  // VC / PE sites embed their portfolio companies' job boards; only keep boards named after the firm.
  const ownBoard = (v) => {
    if (!["vc", "pe"].includes(firm?.kind)) return true;
    const key = (typeof v === "string" ? v : `${v.host} ${v.site || v.domain || ""}`).toLowerCase().replace(/[^a-z0-9]/g, "");
    const host = String(firm.domain || "").split(".")[0].replace(/[^a-z0-9]/g, "");
    return firmTokens(company).some((t) => key.includes(t)) || (host.length > 2 && key.includes(host));
  };
  const fresh = Object.fromEntries(Object.entries(discovered).map(([k, vs]) => [k, vs.filter((v) => !seededKeys.has(seedKey(k, v)) && ownBoard(v))]).filter(([, vs]) => vs.length));
  const tasks = collectorTasks(company, fresh);
  const boards = (await Promise.all(tasks.map((t) => t.run().catch(() => null)))).filter(Boolean);
  const rows = [];
  for (const b of boards) {
    for (const j of await enrichCandidates(b.jobs, { limit: 4, label: `${company} details` })) {
      const verdict = classifyRole({ ...j, Notes: "" }, firm);
      if (!verdict.track) continue;
      rows.push({
        Company: company, Category: firm?.category || "", Track: verdict.track, Confidence: verdict.confidence, Title: j.Title, Department: j.Department,
        Location: j.Location, Commitment: j.Commitment, Workplace: j.Workplace || (verdict.mode === "remote" ? "remote" : ""), URL: j.URL,
        Source: `Career page ${j.Source}`, Status: "Confirmed official posting", PostedAt: j.PostedAt,
        Notes: roleNote(verdict), CareerPage: page.url,
      });
    }
  }
  return {
    rows,
    audit: {
      company, pageUrl, resolvedUrl: page.url, pageOk: page.ok, pageStatus: page.status,
      atsTokens: discovered, unsupportedAts,
      boards: boards.map((b) => ({ source: b.source, jobsSeen: b.jobs.length })),
      jobsSeen: boards.reduce((n, b) => n + b.jobs.length, 0),
      relevantRoles: rows.length,
    },
  };
}

// ---------- browser-audited custom ATS snapshots ----------
async function customWatchRows() {
  let watch = { sites: [] };
  try { watch = JSON.parse(await fs.readFile(watchlistPath, "utf8")); } catch {}
  const rows = [];
  const audits = [];
  for (const site of watch.sites || []) {
    let snap = null;
    try { snap = JSON.parse(await fs.readFile(`custom-ats-watch/snapshots/${site.key}.json`, "utf8")); } catch {}
    const firm = byName.get(site.firm) || { name: site.firm, scope: site.scope || "all" };
    const roles = snap?.roles || [];
    let kept = 0;
    for (const r of roles) {
      const verdict = classifyRole({ Title: r.title, Location: r.location, Department: r.department || "", Content: r.content || "", Commitment: r.commitment || "" }, { ...firm, scope: site.scope || firm.scope });
      if (!verdict.track || !r.url) continue;
      kept += 1;
      rows.push({
        Company: site.firm, Category: firm.category || "", Track: verdict.track, Confidence: verdict.confidence, Title: r.title, Department: r.department || "",
        Location: r.location || "", Commitment: r.commitment || "", Workplace: verdict.mode === "remote" ? "remote" : "", URL: r.url,
        Source: "Custom-ATS watch (browser-rendered official site)", Status: "Confirmed official posting",
        PostedAt: r.postedAt || "", Notes: `snapshot=${snap.capturedAt || "unknown"} | ${roleNote(verdict)}`,
      });
    }
    audits.push({ company: site.firm, key: site.key, snapshotAt: snap?.capturedAt || null, rolesInSnapshot: roles.length, relevantRoles: kept });
  }
  return { rows, audits, watchedFirms: new Set((watch.sites || []).map((s) => s.firm)) };
}

// ---------- web-discovered leads ----------
function webQueries(company) {
  const q = `"${company}"`;
  return [`${q} part-time intern remote`, `${q} intern "spring 2027" OR "academic year" OR "winter 2027"`];
}

const internWords = /\b(intern|internship|co-?op|student|fellow|scout|research assistant)\b/i;
const staleDate = /\b(?:20(?:1\d|2[0-5]))\b|\b(?:spring|summer|winter) 2026\b/i;

async function webLeads(company) {
  const firm = byName.get(company);
  const out = [];
  const seen = new Set();
  for (const query of webQueries(company)) {
    for (const hit of await searchBing(query)) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      const text = `${hit.title} ${hit.snippet}`;
      if (!internWords.test(text) || staleDate.test(hit.title)) continue;
      if (/reddit|wikipedia|youtube|facebook|instagram|\.pdf$|wallstreetoasis|glassdoor\.com\/Interview/i.test(hit.url)) continue;
      if (!firmTokens(company).some((t) => `${text} ${hit.url}`.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(t))) continue;
      const location = /\bremote\b/i.test(text) ? "Remote" : "";
      const verdict = classifyRole({ Title: hit.title, Notes: hit.snippet, Location: location }, firm);
      if (!verdict.track) continue;
      const official = isOfficialUrl(company, hit.url);
      if (!official && !/\b2026|2027\b/.test(text)) continue;
      out.push({
        Company: company, Category: firm?.category || "", Track: verdict.track, Confidence: verdict.confidence, Title: hit.title.replace(/\s+[|\-–]\s+[^|\-–]*$/, ""), Location: location, URL: hit.url,
        Source: official ? "Official posting/page (web-discovered)" : "Web-discovered lead",
        Status: official ? "Likely official; verify application form" : "Aggregator/web lead; verify on official site",
        PostedAt: "", Notes: `${roleNote(verdict)} | ${hit.snippet.slice(0, 300)}`,
      });
    }
  }
  return out;
}

// ---------- run ----------
const searchedAt = new Date().toISOString();
const careerPageDb = await ensureCareerPageDb();
const pageTasks = companies.flatMap((company) => (careerPageDb.companies[company]?.careerPages || []).map((pageUrl) => ({ company, pageUrl })));
const pageResults = await mapLimit(pageTasks, 6, ({ company, pageUrl }) => scanCareerPage(company, pageUrl), "career pages scanned");
const careerPageAudits = pageResults.map((r) => r.audit);
const custom = await customWatchRows();

let baseRows = [];
try {
  baseRows = parseCsv(await fs.readFile(baseCsvPath, "utf8")).map((r) => ({ ...r, Status: "Confirmed official posting" }));
} catch {}
let v1Audit = { companyAudits: [] };
try { v1Audit = JSON.parse(await fs.readFile("data/pts_scan_audit.json", "utf8")); } catch {}

const officialRows = [...baseRows, ...pageResults.flatMap((r) => r.rows), ...custom.rows];
const enumeratedCompanies = new Set([
  ...officialRows.map((r) => r.Company),
  ...v1Audit.companyAudits.filter((a) => (a.resolvedBoards || []).length).map((a) => a.company),
  ...careerPageAudits.filter((a) => a.boards.length).map((a) => a.company),
  ...custom.audits.filter((a) => a.snapshotAt).map((a) => a.company),
]);
const leadCandidates = companies.filter((c) => !enumeratedCompanies.has(c));
const leads = (await mapLimit(leadCandidates, 6, webLeads, "web lead search")).flat();

const rowsByUrl = new Map();
const identity = new Set();
for (const row of [...officialRows, ...leads]) {
  if (!row.URL) continue;
  const key = row.URL.toLowerCase().replace(/[#].*$/, "").replace(/\/$/, "");
  if (rowsByUrl.has(key)) continue;
  const id = `${row.Company}\n${row.Title}`.toLowerCase();
  const fullId = `${id}\n${row.Location || ""}`.toLowerCase();
  const official = /official|career page|custom-ats/i.test(`${row.Source} ${row.Status}`) && !/aggregator|web lead/i.test(`${row.Source} ${row.Status}`);
  if (!official && identity.has(id)) continue;
  if (official && identity.has(fullId)) continue;
  if (row.Notes?.length > 900) row.Notes = `${row.Notes.slice(0, 900)}...`;
  row.Region = regionForLocation(row.Location);
  rowsByUrl.set(key, row);
  if (official) { identity.add(id); identity.add(fullId); }
}
const rows = [...rowsByUrl.values()].sort((a, b) => a.Company.localeCompare(b.Company) || a.Title.localeCompare(b.Title));
const partTimeRows = rows.filter((r) => r.Confidence === "part-time");
const hoursNotStatedRows = rows.filter((r) => r.Confidence !== "part-time");

// ---------- coverage classification ----------
const coverage = new Map(); // company -> jobs seen on enumerated official sources
for (const a of v1Audit.companyAudits) if ((a.resolvedBoards || []).length) coverage.set(a.company, Math.max(coverage.get(a.company) || 0, a.jobsSeen || 0));
for (const a of careerPageAudits) if (a.boards.length) coverage.set(a.company, Math.max(coverage.get(a.company) || 0, a.jobsSeen));
for (const a of custom.audits) if (a.snapshotAt) coverage.set(a.company, Math.max(coverage.get(a.company) || 0, a.rolesInSnapshot));
const unsupported = new Set(careerPageAudits.filter((a) => a.unsupportedAts.length).map((a) => a.company));
for (const f of custom.watchedFirms) if (!custom.audits.find((a) => a.company === f && a.snapshotAt)) unsupported.add(f);

const companiesWithoutRows = companies.filter((c) => !rows.some((r) => r.Company === c)).sort();
const confirmedNoOpenPostings = companiesWithoutRows.filter((c) => coverage.has(c) && coverage.get(c) === 0 && !unsupported.has(c));
const confirmedNoMatchingRoles = companiesWithoutRows.filter((c) => (coverage.get(c) || 0) > 0 && !unsupported.has(c));
const couldNotFullyVerify = companiesWithoutRows.filter((c) => !coverage.has(c) || unsupported.has(c));

// ---------- outputs ----------
const headers = ["Company", "Category", "Track", "Confidence", "Title", "Department", "Location", "Region", "Commitment", "Workplace", "URL", "Source", "Status", "PostedAt", "Notes"];
await fs.writeFile("reports/pts_roles_scan_v2.csv", toCsv(rows, headers), "utf8");

const statusGuide = [
  "Status guide:",
  "- Confirmed official posting: enumerated directly from the employer's official ATS / careers site.",
  "- Likely official; verify application form: web result on the employer's own domain or ATS.",
  "- Aggregator/web lead; verify on official site: surfaced on a job board; confirm before applying.",
];
const md = [
  "# Part-Time Internship Scan v2",
  "",
  `Scanned: ${searchedAt}`,
  `Employers searched: ${companies.length}`,
  `Career pages checked: ${pageTasks.length}`,
  `Part-time roles: ${partTimeRows.length}`,
  `Term-time roles, hours not stated: ${hoursNotStatedRows.length}`,
  "",
  "Scope: part-time / academic-year / term-time internships (fall 2026, winter and spring 2027) in software engineering, data (data science, analytics, ML, data engineering) and finance (asset management, hedge funds, investment research, PE/VC, fintech), plus VC scout programs and UChicago student research-assistant roles. Remote in the US only, except UChicago roles. Summer-only, full-time off-cycle co-ops, senior, PhD/MBA-only and roles running past June 2027 are excluded.",
  "",
  ...statusGuide,
  "",
  "## Part-Time Roles By Track",
  "",
  ...groupedRoleMarkdown(partTimeRows),
  "## Term-Time Roles, Hours Not Stated (check the posting)",
  "",
  ...groupedRoleMarkdown(hoursNotStatedRows),
  "## Confirmed: Enumerated Source Reports No Open Postings",
  "",
  confirmedNoOpenPostings.length ? confirmedNoOpenPostings.map((c) => `- ${c}`).join("\n") : "_None._",
  "",
  "## Confirmed: Open Postings Exist, None Matched",
  "",
  confirmedNoMatchingRoles.length ? confirmedNoMatchingRoles.map((c) => `- ${c}`).join("\n") : "_None._",
  "",
  "## Unverified: Could Not Fully Enumerate",
  "",
  "No official source was enumerated (custom careers portal, unsupported ATS, form-only scout program, or no careers page found). Absence of a role here is not evidence that none exists.",
  "",
  couldNotFullyVerify.length ? couldNotFullyVerify.map((c) => `- ${c}`).join("\n") : "_None._",
  "",
].join("\n");
await fs.writeFile("reports/pts_roles_scan_v2.md", md, "utf8");

await fs.writeFile("data/pts_roles_scan_v2_raw.json", JSON.stringify({
  searchedAt, companies, careerPageDb, careerPageScanTasks: pageTasks, careerPageScanAudits: careerPageAudits,
  customSourceAudits: custom.audits, rows, companiesWithoutRows, confirmedNoOpenPostings, confirmedNoMatchingRoles, couldNotFullyVerify,
}, null, 2), "utf8");
await fs.writeFile("data/pts_roles_scan_v2_audit.json", JSON.stringify({
  searchedAt,
  companies,
  companiesWithoutKnownCareerPage: companies.filter((c) => !(careerPageDb.companies[c]?.careerPages || []).length),
  careerPageScanAudits: careerPageAudits,
  customSourceAudits: custom.audits,
}, null, 2), "utf8");

console.log(`employers=${companies.length} careerPages=${pageTasks.length} partTime=${partTimeRows.length} hoursNotStated=${hoursNotStatedRows.length} noOpen=${confirmedNoOpenPostings.length} noMatch=${confirmedNoMatchingRoles.length} unverified=${couldNotFullyVerify.length}`);
console.log("wrote pts_roles_scan_v2.csv/.md, pts_roles_scan_v2_raw.json, pts_roles_scan_v2_audit.json");
