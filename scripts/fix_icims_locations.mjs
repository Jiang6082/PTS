// Post-processing for the v1 scan: iCIMS search pages don't reliably tie a "Job Locations"
// header to the right job card, so re-read each iCIMS job's own page (schema.org JSON-LD)
// for its location, and let a city named in the title win over a conflicting list value.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchText, mapLimit, parseCsv, stripHtml, toCsv } from "../tools/common.mjs";

const CSV = "reports/pts_roles_scan.csv";
const HEADERS = ["Company", "Category", "Track", "Confidence", "Title", "Department", "Location", "Commitment", "Workplace", "URL", "Source", "PostedAt", "Notes"];
const TITLE_CITIES = ["Brussels", "Paris", "London", "Beijing", "Shanghai", "Munich", "Berlin", "Frankfurt", "Madrid", "Milan", "Zurich", "Montreal", "Toronto", "Boston", "Chicago", "New York", "Washington", "Los Angeles", "Menlo Park", "San Francisco", "Dallas", "Denver", "Houston", "Singapore", "Hong Kong", "Sydney", "Remote"];

function jsonLdLocation(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || !/JobPosting/i.test(String(item["@type"] || ""))) continue;
      const locs = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation].filter(Boolean);
      const names = locs.map((l) => {
        const a = l?.address || {};
        return [a.addressLocality, a.addressRegion, typeof a.addressCountry === "string" ? a.addressCountry : a.addressCountry?.name].filter((v) => v && !/^unavailable$/i.test(String(v).trim())).join(", ");
      }).filter(Boolean);
      if (names.length) return [...new Set(names)].join(" | ");
    }
  }
  const field = html.match(/Job Locations?\s*(?:<\/[^>]+>\s*)*<[^>]+>([\s\S]*?)<\//i)?.[1];
  return field ? stripHtml(field) : "";
}

export function titleCity(title = "") {
  const cities = TITLE_CITIES.filter((c) => new RegExp(`(?:^|[-–/|(]\\s*)${c}\\b`, "i").test(title));
  return cities.length ? cities.join(" / ") : "";
}

export function reconcile(title, location) {
  const city = titleCity(title);
  if (!city) return location;
  const loc = String(location || "").toLowerCase();
  return city.split(" / ").every((c) => loc.includes(c.toLowerCase())) ? location : city;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let rows = [];
  try { rows = parseCsv(await fs.readFile(CSV, "utf8")); } catch { process.exit(0); }
  let fixed = 0;
  await mapLimit(rows.filter((r) => /icims\.com\/jobs\/\d+/i.test(r.URL)), 6, async (r) => {
    const res = await fetchText(`${r.URL}${r.URL.includes("?") ? "&" : "?"}in_iframe=1`, { timeoutMs: 12000 });
    const detail = res.ok ? jsonLdLocation(res.text) : "";
    const next = reconcile(r.Title, detail || r.Location);
    if (next && next !== r.Location) { r.Location = next; fixed += 1; }
  }, "icims locations");
  await fs.writeFile(CSV, toCsv(rows, HEADERS), "utf8");
  console.log(`icims locations: corrected ${fixed}`);
}
