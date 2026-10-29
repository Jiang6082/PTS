// Pulls ATS board identifiers out of a career page (HTML + linked scripts) so the
// scanner can enumerate the underlying board directly. Output uses the same keys as
// inputs/ats_seeds.json so it can be merged with hand-seeded boards.
import { decodeHtml } from "./common.mjs";

const IGNORE_GH = new Set(["embed", "v1", "boards", "jobs", "job_app", "api", "js"]);

export function extractAtsTokens(rawText = "") {
  const text = decodeHtml(rawText).replace(/\\\//g, "/");
  const sets = {};
  const add = (key, value) => {
    if (!value) return;
    const v = typeof value === "string" ? value.replace(/[)"'\\].*$/, "").trim() : value;
    if (typeof v === "string" && !v) return;
    (sets[key] ||= new Map()).set(typeof v === "string" ? v.toLowerCase() : `${v.host}/${v.site || v.domain}`.toLowerCase(), v);
  };

  for (const m of text.matchAll(/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi)) add("greenhouse", m[1]);
  for (const m of text.matchAll(/boards-api\.eu\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi)) add("greenhouse_eu", m[1]);
  for (const m of text.matchAll(/(?:job-)?boards\.greenhouse\.io\/embed\/job_board(?:\/js)?\?[^"'\s]*?\bfor=([a-z0-9_-]+)/gi)) add("greenhouse", m[1]);
  for (const m of text.matchAll(/(?:job-)?boards\.eu\.greenhouse\.io\/embed\/job_board(?:\/js)?\?[^"'\s]*?\bfor=([a-z0-9_-]+)/gi)) add("greenhouse_eu", m[1]);
  for (const m of text.matchAll(/(?<!eu\.)(?:job-)?boards\.greenhouse\.io\/([a-z0-9_-]+)/gi)) if (!IGNORE_GH.has(m[1].toLowerCase())) add("greenhouse", m[1]);
  for (const m of text.matchAll(/(?:job-)?boards\.eu\.greenhouse\.io\/([a-z0-9_-]+)/gi)) if (!IGNORE_GH.has(m[1].toLowerCase())) add("greenhouse_eu", m[1]);

  for (const m of text.matchAll(/api\.lever\.co\/v0\/postings\/([a-z0-9_.-]+)|(?<!eu\.)jobs\.lever\.co\/([a-z0-9_.-]+)/gi)) add("lever", m[1] || m[2]);
  for (const m of text.matchAll(/api\.eu\.lever\.co\/v0\/postings\/([a-z0-9_.-]+)|jobs\.eu\.lever\.co\/([a-z0-9_.-]+)/gi)) add("lever_eu", m[1] || m[2]);
  for (const m of text.matchAll(/api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9_.-]+)|jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi)) add("ashby", m[1] || m[2]);
  for (const m of text.matchAll(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)|api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]+)/gi)) {
    const t = m[1] || m[2];
    if (!/^(oneclick-ui|sr-jobs|widget|js)$/i.test(t)) add("smartrecruiters", t);
  }
  for (const m of text.matchAll(/apply\.workable\.com\/(?:api\/v\d\/accounts\/)?([a-z0-9_-]+)/gi)) if (!/^(api|j)$/i.test(m[1])) add("workable", m[1]);
  for (const m of text.matchAll(/([a-z0-9-]+)\.jobs\.personio\.(de|com)/gi)) add(m[2].toLowerCase() === "com" ? "personio_com" : "personio", m[1]);
  for (const m of text.matchAll(/([a-z0-9-]+)\.teamtailor\.com/gi)) if (!/^(app|cdn|assets|scripts)$/i.test(m[1])) add("teamtailor", m[1]);
  for (const m of text.matchAll(/([a-z0-9-]+)\.pinpointhq\.com/gi)) if (!/^(www|app|api)$/i.test(m[1])) add("pinpoint", m[1]);
  for (const m of text.matchAll(/([a-z0-9-]+)\.breezy\.hr/gi)) if (!/^(app|www|assets)$/i.test(m[1])) add("breezy", m[1]);
  for (const m of text.matchAll(/([a-z0-9-]+)\.applytojob\.com/gi)) if (!/^(www|app)$/i.test(m[1])) add("jazzhr", m[1]);
  for (const m of text.matchAll(/([a-z0-9-]+)\.hire\.trakstar\.com/gi)) add("trakstar", m[1]);
  for (const m of text.matchAll(/((?:careers|jobs|[a-z0-9]+)-[a-z0-9-]+)\.icims\.com/gi)) add("icims", m[1]);
  for (const m of text.matchAll(/recruiting\.paylocity\.com\/recruiting\/jobs\/(?:All|List)\/([0-9a-f-]{36})/gi)) add("paylocity", m[1]);
  for (const m of text.matchAll(/https?:\/\/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g)) {
    if (!/^(wday|en-US|cxs)$/i.test(m[2])) add("workday", { host: m[1].toLowerCase(), site: m[2] });
  }
  for (const m of text.matchAll(/https?:\/\/([a-z0-9-]+)\.eightfold\.ai\/careers[^"'\s]*?[?&]domain=([a-z0-9.-]+)/gi)) {
    add("eightfold", { host: `${m[1].toLowerCase()}.eightfold.ai`, domain: m[2].toLowerCase() });
  }
  for (const m of text.matchAll(/https?:\/\/([a-z0-9-]+\.fa\.[a-z0-9]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z]{2}\/sites\/([A-Za-z0-9_-]+)/gi)) {
    add("oracle", { host: m[1].toLowerCase(), site: m[2] });
  }

  return Object.fromEntries(Object.entries(sets).map(([k, map]) => [k, [...map.values()]]));
}

// ATS/career systems we recognise but cannot enumerate from Node. A company whose
// page uses one of these is reported as "could not fully verify" rather than
// "no roles", and belongs in custom-ats-watch/watchlist.json.
export function detectUnsupportedAts(text = "") {
  const systems = {
    avature: /avature\.net/i,
    brassring: /brassring\.com/i,
    jobvite: /jobvite\.com/i,
    phenom: /phenompeople\.com|cdn\.phenom\.com/i,
    radancy: /radancy|tbcdn\.talentbrew\.com/i,
    successfactors: /successfactors\.(?:com|eu)|jobs\.sap\.com/i,
    taleo: /taleo\.net/i,
    ultipro: /recruiting\.ultipro\.com|recruiting2\.ultipro\.com/i,
    virecruit: /viglobalcloud\.com/i,
    gohire: /gohire\.io/i,
    dayforce: /dayforcehcm\.com/i,
    adp: /workforcenow\.adp\.com|myjobs\.adp\.com/i,
    bamboohr: /\.bamboohr\.com\/careers/i,
    rippling: /ats\.rippling\.com/i,
  };
  return Object.entries(systems).filter(([, re]) => re.test(text)).map(([name]) => name);
}
