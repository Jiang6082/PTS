// Detail-page enrichment. Several ATS list APIs (Workday, SmartRecruiters, Workable, Oracle,
// iCIMS, Teamtailor, JazzHR, ...) return only title + location, but the part-time signal
// usually lives in the description ("15-20 hours per week") or a schedule field
// ("Time Type: Part time"). For postings whose title passes isCandidateTitle(), fetch the
// detail record once and fill Content / Commitment / Workplace / Location.
import { fetchJson, fetchText, mapLimit, stripHtml } from "./common.mjs";
import { normalizeWorkplace } from "./collectors.mjs";
import { isCandidateTitle } from "./relevance.mjs";

const HAS_FULL_CONTENT = /^(Greenhouse|Lever|Ashby|Amazon|Pinpoint)/;

export function jsonLdJobPosting(html = "") {
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const items = (Array.isArray(data) ? data : [data]).flatMap((d) => (d?.["@graph"] ? d["@graph"] : [d]));
    const item = items.find((i) => i && /JobPosting/i.test(String(i["@type"] || "")));
    if (!item) continue;
    const locs = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation].filter(Boolean);
    const location = [...new Set(locs.map((l) => {
      const a = l?.address || {};
      return [a.addressLocality, a.addressRegion, typeof a.addressCountry === "string" ? a.addressCountry : a.addressCountry?.name]
        .filter((v) => v && !/^unavailable$/i.test(String(v).trim())).join(", ");
    }).filter(Boolean))].join(" | ");
    const type = Array.isArray(item.employmentType) ? item.employmentType.join(", ") : item.employmentType || "";
    const remote = /TELECOMMUTE/i.test(String(item.jobLocationType || "")) || item.applicantLocationRequirements ? "remote" : "";
    return { content: stripHtml(item.description || ""), commitment: String(type).replace(/_/g, "-"), workplace: remote, location };
  }
  return null;
}

async function detailFor(job) {
  const src = job.Source || "";
  if (src.startsWith("Workday") && job.DetailURL) {
    const info = (await fetchJson(job.DetailURL))?.jobPostingInfo;
    if (!info) return null;
    return {
      content: stripHtml(`${info.jobDescription || ""} ${info.startDate ? `Start date: ${info.startDate}` : ""}`),
      commitment: info.timeType || "",
      workplace: info.remoteType || (/\bremote\b/i.test(`${info.location || ""} ${(info.additionalLocations || []).join(" ")}`) ? "remote" : ""),
      location: [info.location, ...(info.additionalLocations || [])].filter(Boolean).join("; "),
    };
  }
  if (src.startsWith("SmartRecruiters") && job.DetailURL) {
    const d = await fetchJson(job.DetailURL);
    if (!d) return null;
    const sections = d.jobAd?.sections || {};
    return {
      content: stripHtml(Object.values(sections).map((x) => x?.text || "").join(" ")),
      commitment: d.typeOfEmployment?.label || "",
      workplace: d.location?.remote ? "remote" : d.location?.hybrid ? "hybrid" : "",
      location: "",
    };
  }
  if (src.startsWith("Workable") && job.DetailURL) {
    const d = await fetchJson(job.DetailURL);
    if (!d) return null;
    return {
      content: stripHtml(`${d.description || ""} ${d.requirements || ""} ${d.benefits || ""}`),
      commitment: d.type || d.employment_type || "",
      workplace: d.workplace || (d.remote ? "remote" : ""),
      location: "",
    };
  }
  if (src.startsWith("Oracle") && job.DetailURL) {
    const d = (await fetchJson(job.DetailURL))?.items?.[0];
    if (!d) return null;
    return {
      content: stripHtml(`${d.ExternalDescriptionStr || ""} ${d.ExternalResponsibilitiesStr || ""} ${d.ExternalQualificationsStr || ""} ${d.CorporateDescriptionStr || ""}`),
      commitment: d.JobSchedule || d.WorkerType || "",
      workplace: d.WorkplaceType || d.WorkplaceTypeCode || "",
      location: "",
    };
  }
  // Everything else (iCIMS, Teamtailor, JazzHR, Breezy, Trakstar, Paylocity, Eightfold, career pages):
  // read the posting page's schema.org JobPosting, else its visible text.
  const url = job.DetailURL || job.URL;
  if (!url) return null;
  const res = await fetchText(url, { timeoutMs: 12000 });
  if (!res.ok) return null;
  const ld = jsonLdJobPosting(res.text);
  if (ld) return ld;
  const text = stripHtml(res.text.replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " "));
  return { content: text.slice(0, 20000), commitment: "", workplace: "", location: "" };
}

export async function enrichJob(job) {
  if (HAS_FULL_CONTENT.test(job.Source || "") && job.Content) return job;
  try {
    const d = await detailFor(job);
    if (!d) return job;
    const out = { ...job };
    if (d.content && d.content.length > (job.Content || "").length) out.Content = d.content.slice(0, 20000);
    if (d.commitment && !out.Commitment) out.Commitment = d.commitment;
    const wp = normalizeWorkplace(d.workplace);
    if (wp && !out.Workplace) out.Workplace = wp;
    if (d.location && (!out.Location || /^\d+ Locations?$/i.test(out.Location))) out.Location = d.location;
    return out;
  } catch {
    return job;
  }
}

// Enrich only postings that could plausibly pass the filter (keeps request volume low).
export async function enrichCandidates(jobs, { limit = 8, label = "detail pages" } = {}) {
  const idx = jobs.map((j, i) => (isCandidateTitle(j.Title) ? i : -1)).filter((i) => i >= 0);
  const enriched = await mapLimit(idx, limit, (i) => enrichJob(jobs[i]), label);
  const out = jobs.slice();
  idx.forEach((i, k) => { out[i] = enriched[k]; });
  return out;
}
