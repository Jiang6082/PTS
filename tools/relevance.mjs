// PTS role filter: part-time / term-time internships in software, data and finance that
// run inside the scan window (now -> June 2027), remote-only (except localOk employers).
//
// classifyRole(row, firm, { now }) -> {
//   track: "Software" | "Data" | "Finance" | "VC Scout" | "Research Assistant" | null,
//   confidence: "part-time" | "hours not stated" | null,
//   reason, evidence, hours, term
// }
//   row  = { Title, Department, Location, Commitment, Workplace, Content/Notes }
//   firm = roster entry { scope, kind: "vc" | "uchicago" | ..., localOk, category }
//
// "part-time"        = an explicit part-time signal (commitment field, title, <=30 hrs/week,
//                      academic-year / school-year / while-enrolled wording, VC scout).
// "hours not stated" = a student role dated for a fall/winter/spring term inside the window
//                      with no full-time statement either way. Reported separately.

import { regionForLocation } from "./regions.mjs";

export const WINDOW_END = "2027-06-30";
export const MAX_PART_TIME_HOURS = 30;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (m) => MONTHS.findIndex((name) => name.startsWith(String(m).toLowerCase().slice(0, 3)));

// ---------- role-type signals ----------
const studentTitle = /\b(interns?|internships?|co-?ops?|students?|working student|werkstudent(?:in)?|fellows?(?:hip)?|scouts?|campus (?:ambassador|partner|lead|rep(?:resentative)?)|student ambassador|apprentice(?:ship)?|research (?:assistant|aide)|undergrad(?:uate)?s?|externs?(?:hip)?|trainees?|university program|early career program)\b/i;
const studentBody = /\b(currently enrolled|current(?:ly)? (?:an? )?(?:undergraduate|college|university) student|pursuing (?:an? |your )?(?:bachelor'?s|undergraduate|b\.?s\.?|b\.?a\.?)|enrolled (?:in|at) an? (?:accredited )?(?:college|university|degree program)|open to (?:current )?students)\b/i;

// ---------- part-time / full-time signals ----------
const partTimeTitle = (text = "") => /\bpart[- ]?time\b/i.test(text) || /\bPT\b/.test(text); // "PT" is case-sensitive
const partTimeBody = /\bpart[- ]?time\b|\b(?:academic|school)[- ]year (?:intern(?:ship)?|position|role|program(?:me)?|commitment)|\bduring the (?:academic|school) year\b|\bthroughout the (?:academic|school) year\b|\bterm[- ]time\b|\bduring the (?:fall|winter|spring|autumn)? ?(?:semester|quarter|term)s?\b|\bwhile (?:you are )?(?:in school|attending (?:school|classes|college)|enrolled|taking classes)\b|\balongside (?:your )?(?:studies|classes|coursework)\b|\b(?:around|with) (?:your )?(?:class|course|academic) schedule\b|\bflexible (?:weekly )?(?:hours|schedule)\b|\bwork[- ]study\b|\bstudent (?:worker|employee|employment)\b|\bwerkstudent(?:in)?\b|\bworking student\b/i;
const partTimeNegated = /\b(?:no|not (?:a|offering|offer(?:ed)?|available as a)?|isn'?t a|is not a|cannot be|can'?t be) part[- ]?time\b|\bpart[- ]?time (?:is |are )?(?:not|isn'?t) (?:available|possible|an option|offered|considered)\b/i;
const fullTimeBody = /\bfull[- ]?time,? (?:paid |remote |in[- ]person |on[- ]?site )?(?:internship|intern|co-?op|role|position|commitment|schedule|basis)\b|\b(?:this|the) (?:internship|role|position|co-?op) is (?:a )?full[- ]?time\b|\bmust be (?:able to work |available (?:to work )?)full[- ]?time\b|\b40 (?:hours|hrs)(?: per| a| \/) ?(?:week|wk)\b|\btake (?:a|the|one) (?:semester|quarter|term) off\b|\bgap (?:semester|year|term)\b|\bnot (?:be )?enrolled in classes\b/i;
const fullTimeTitle = /\bfull[- ]?time\b/i;

function commitmentSignal(commitment = "") {
  const c = String(commitment).toLowerCase().replace(/[_-]/g, " ");
  if (!c.trim()) return null;
  if (/\bpart ?time\b|\bparttime\b/.test(c)) return "part-time";
  if (/\bfull ?time\b|\bfulltime\b/.test(c)) return "full-time";
  return null;
}

// Weekly-hours figures stated (upper end of each range), e.g. "15-20 hours per week" -> [20].
export function weeklyHoursList(text = "") {
  const t = String(text).replace(/[–—]/g, "-");
  const per = "(?:hours?|hrs?\\.?|h)\\s*(?:\\/|per|a|each|every)?\\s*(?:week|wk)\\b|(?:hours?|hrs?)\\s+weekly\\b";
  const found = [];
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\s*(?:-|to)\\s*(\\d{1,2})\\s*(?:${per})`, "gi"))) found.push(Number(m[2]));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\+?\\s*(?:${per})`, "gi"))) found.push(Number(m[1]));
  return found.filter((n) => n >= 3 && n <= 60);
}

// The smallest stated weekly cap: a posting saying "15-20 hrs/week during the semester,
// up to 40 in summer" is part-time during the term.
export function statedWeeklyHours(text = "") {
  const list = weeklyHoursList(text);
  return list.length ? Math.min(...list) : null;
}

// ---------- domain tracks ----------
const softwareTitle = /\b(software|swe|sde|developer|programm(?:er|ing)|back[- ]?end|front[- ]?end|full[- ]?stack|web (?:dev|engineer)|mobile|ios|android|devops|dev ops|site reliability|\bsre\b|platform engineer|infrastructure engineer|cloud engineer|systems engineer|engineering intern|engineer intern|forward deployed|solutions engineer|security engineer|application engineer|it analytics|computer science|\bcs\b|tech(?:nology)? intern|r&d intern|research engineer)\b/i;
const dataTitle = /\b(data|analytics?|machine learning|\bml\b|\bai\b|artificial intelligence|deep learning|\bnlp\b|computer vision|llm|statistic\w*|quantitative|\bquant\b|business intelligence|\bbi\b|data engineer\w*|research scientist|applied scientist|decision science|econometric\w*|insights?)\b/i;
const financeTitle = /\b(invest\w*|asset management|portfolio|equity research|credit research|(?:investment|fund|market|equity|credit) research|hedge fund|trad(?:ing|er)|markets?|private (?:equity|credit|markets)|venture|\bvc\b|growth equity|fund(?:s)?\b|wealth management|fixed income|equities|valuation|financial analyst|finance|fintech|capital markets|real estate investment|underwriting|risk analyst|risk management|treasury markets)\b/i;
const scoutTitle = /\b(scouts?|venture (?:fellow|partner|associate program)|campus (?:ambassador|partner|lead|rep(?:resentative)?)|student (?:partner|ambassador|investor)|investment team fellow|venture fellow(?:ship)?)\b/i;
const genericTechTitle = /\b(engineering|r&d|technology|technical|tech|product engineering|research)\b/i;
const strongSoftwareBody = /\b(python|javascript|typescript|java\b|golang|\bgo\b|rust|c\+\+|react|node\.?js|sql|software development|programming|codebase|git\b|apis?\b|machine learning|data pipelines?)\b/gi;
const raDomainBody = /\b(python|stata|\br\b|sql|matlab|programming|coding|computer science|statistic\w*|data (?:analysis|science|collection|cleaning|management)|econometric\w*|quantitative|machine learning|finance|financial|econom\w*)\b/i;

// Never software/data/finance internships even when a keyword matches.
const blockedFunction = /\b(human resources|\bhr\b|people (?:team|operations|partner)|talent acquisition|recruit(?:ing|ment|er)|marketing|brand|communications|public relations|social media|content (?:writer|creator|marketing)|copywrit\w*|editorial|journalis\w*|graphic|ux designer|visual designer|industrial design|product design(?:er)?|facilities|reception\w*|administrative|executive assistant|office assistant|legal|paralegal|law clerk|policy intern|government affairs|customer (?:support|success|service|experience)|account (?:executive|manager)|sales|business development|partnerships|events?|accounting|accountant|audit|tax\b|payroll|accounts (?:payable|receivable)|bookkeep\w*|investment banking|\bm&a\b|mergers|corporate finance|fp&a|financial planning|corporate development|controller|procurement|supply chain|logistics|warehouse|retail|store|barista|driver|nurs\w*|clinical|medical|pharmac\w*|radiolog\w*|technologist|patient|hospital|qualitative|teaching assistant|tutor\b|coach|mechanical|electrical|civil|chemical|manufacturing|hardware|firmware|process engineer|industrial engineer|aerospace|propulsion|structural|field (?:technician|service)|technician|security (?:officer|guard)|grc\b|governance,? risk|compliance)\b/i;

const seniority = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vice president|\bvp\b|chief|architect|experienced|lateral|associate director|(?:engineer|analyst|scientist|developer|assistant) (?:ii|iii|iv|2|3|4)\b|level (?:ii|iii|2|3)\b)\b/i;
const blockedEducation = /\b(ph\.?d|doctoral|doctorate|postdoc\w*|post-doc\w*|mba|j\.?d\.?|law (?:student|school)|medical student|graduate (?:student )?intern(?:ship)?)\b/i;
const educationAllowed = /\b(bachelor|undergrad\w*|b\.?a\.?\/b\.?s|bs\/ms|master'?s|\bms\b|msc|college student)\b/i;
const phdOnlyBody = /\b(?:must be (?:currently )?(?:working towards|pursuing|enrolled in) a ph\.?d|ph\.?d\.? (?:candidates|students) only|open (?:only )?to ph\.?d|doctoral (?:candidates|students) only|currently enrolled in a (?:ph\.?d|doctoral))\b/i;
const recruitingEvent = /\b(networking|information session|info session|career fair|open house|webinar|talent (?:community|network|pool)|general (?:application|interest)|expression of interest|future opportunit\w*|join our talent|resume (?:drop|submission)|evergreen)\b/i;
const newGradTitle = /\b(new grad(?:uate)?|graduate program(?:me)?|entry[- ]level|full[- ]time (?:hire|role|position)|class of 20\d\d)\b/i;

// ---------- location ----------
const remoteWords = /\b(remote|anywhere|work from home|wfh|virtual|telecommut\w*|distributed|home[- ]based)\b/i;
const remoteBody = /\b(?:this (?:is a |is an )?(?:fully |100% )?remote (?:internship|role|position|opportunity|program)|(?:internship|role|position|program) is (?:fully |100% |entirely )?(?:remote|virtual)|(?:fully|100%|entirely) (?:remote|virtual)|work (?:fully )?remotely|remote[- ]first internship|remote internship|virtual internship)\b/i;
const remoteBodyStrong = /\b(?:(?:this|the) (?:internship|role|position|program|opportunity) (?:is|will be|can be) (?:a )?(?:fully |100% |entirely )?(?:remote|virtual)|(?:fully|100%|entirely) remote (?:internship|role|position|program)|remote by default|work from anywhere in the (?:us|u\.s\.|united states))\b/i;
const hybridWords = /\b(hybrid|in[- ]office|on[- ]?site|onsite|in[- ]person)\b/i;
const nonUsPlace = /\b(canada|toronto|vancouver|montreal|ontario|quebec|mexico|brazil|argentina|colombia|united kingdom|\buk\b|england|london|ireland|dublin|europe|emea|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|poland|portugal|switzerland|zurich|italy|sweden|denmark|norway|finland|czech|romania|israel|tel aviv|india|bangalore|bengaluru|hyderabad|pune|singapore|hong kong|china|japan|tokyo|korea|australia|sydney|new zealand|philippines|vietnam|indonesia|malaysia|nigeria|kenya|south africa|apac|latam|serbia|belgrade|ukraine|kyiv|armenia|yerevan|lithuania|vilnius|estonia|tallinn|latvia|riga|greece|athens|turkey|istanbul|egypt|cairo|pakistan|bangladesh|taiwan|taipei|thailand|bangkok|chile|santiago|peru|lima|uruguay|montevideo|costa rica|bulgaria|sofia|croatia|hungary|budapest|austria|vienna|belgium|brussels|scotland|edinburgh|wales|cyprus|malta|dubai|uae|saudi|qatar|nairobi|lagos|cape town|johannesburg)\b/i;
const usPlace = /\b(united states|\bu\.?s\.?a?\b|\bus\b|americas|north america|nationwide|any us state|us[- ]based)\b|,\s*(?:al|ak|az|ar|ca|co|ct|de|dc|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;
const chicagoPlace = /\b(chicago|hyde park|illinois|\bil\b|evanston|lemont|cook county)\b/i;

// Location strings that don't pin the job to a specific city.
const genericLocation = /^\s*(?:united states(?: of america)?|usa|u\.?s\.?a?\.?|us|north america|americas|anywhere|nationwide|multiple locations|various locations|\d+ locations?)?\s*$/i;
const timeZoneHint = /\b(?:time ?zones?|pst|pdt|est|edt|cst|cdt|mst|[ecmp]t)\b/i;

export function remoteStatus(row = {}, firm = {}) {
  const loc = String(row.Location || "");
  const workplace = String(row.Workplace || "").toLowerCase();
  const body = String(row.Content || row.Notes || "");
  const head = `${row.Title || ""} ${loc}`;
  // A posting pinned to a specific city only counts as remote when the location/title or
  // the ATS workplace field says so, or the description states the role itself is remote
  // ("this internship is fully remote"). Generic culture text ("we work remotely") isn't enough.
  const specific = !genericLocation.test(loc.replace(/[()]/g, " "));
  const bodySaysRemote = specific ? remoteBodyStrong.test(body) : remoteBody.test(body);
  const isRemote = workplace === "remote" || remoteWords.test(head) || (!hybridWords.test(head) && workplace !== "hybrid" && workplace !== "onsite" && bodySaysRemote);
  const hybridOnly = (workplace === "hybrid" || /\bhybrid\b/i.test(head)) && !remoteWords.test(head) && workplace !== "remote";
  if (isRemote && !hybridOnly) {
    // Remote, but restricted to another country (e.g. "Remote - Canada", "Belgrade")?
    const where = loc.replace(new RegExp(remoteWords.source, "gi"), " ").replace(/[-–|,;/()]+/g, " ").trim();
    if (nonUsPlace.test(where) && !usPlace.test(where)) return { ok: false, reason: "remote outside the US" };
    if (where && !genericLocation.test(where) && !usPlace.test(where) && !timeZoneHint.test(where)
      && !/\b(?:worldwide|global|anywhere)\b/i.test(where) && regionForLocation(where) !== "North America") {
      return { ok: false, reason: "remote outside the US" };
    }
    return { ok: true, mode: "remote" };
  }
  if (firm.localOk) {
    if (!loc.trim() || chicagoPlace.test(loc)) return { ok: true, mode: "local" };
    return { ok: false, reason: "local employer, role not in Chicago" };
  }
  if (hybridOnly) return { ok: false, reason: "hybrid (remote only)" };
  return { ok: false, reason: "not remote" };
}

// ---------- dates ----------
// A season or month + year mention -> [start, end] (ISO dates).
function termRange(season, year) {
  const y = Number(year);
  const s = String(season).toLowerCase();
  if (/spring/.test(s)) return [`${y}-01-01`, `${y}-05-31`];
  if (/summer/.test(s)) return [`${y}-06-01`, `${y}-08-31`];
  if (/fall|autumn/.test(s)) return [`${y}-08-15`, `${y}-12-31`];
  if (/winter/.test(s)) return [`${y}-01-01`, `${y}-04-30`];
  const mi = monthIndex(s);
  if (mi >= 0) {
    const mm = String(mi + 1).padStart(2, "0");
    return [`${y}-${mm}-01`, `${y}-${mm}-28`];
  }
  return null;
}

const SEASON_YEAR = new RegExp(`\\b(spring|summer|fall|autumn|winter|${MONTH_RE.replace("(", "(?:")})\\s*(?:term|semester|quarter|session|cohort)?\\s*(?:of\\s*)?(?:(20\\d{2})|['’](\\d{2}))\\b`, "gi");
const SEASON_PAIR = /\b(spring|summer|fall|autumn|winter)\s*(?:&|and|\/|-|–|,|or|\+)\s*(?:(?:spring|summer|fall|autumn|winter)\s*(?:&|and|\/|-|–|,|or|\+)\s*)?(?:spring|summer|fall|autumn|winter)\s*(20\d{2})\b/gi;
const YEAR_SEASON = /\b(20\d{2})\s*(spring|summer|fall|autumn|winter)\b/gi;
const ACADEMIC_YEAR = /\b(?:(?:academic|school)\s+year\s*|ay\s*)?(20\d{2})\s*[-–\/]\s*(20\d{2}|\d{2})\b(?:\s*(?:academic|school)\s+year)?/gi;

export function termMentions(text = "") {
  const t = String(text);
  const out = [];
  for (const m of t.matchAll(SEASON_YEAR)) {
    const y = m[2] || `20${m[3]}`;
    const r = termRange(m[1], y);
    if (r) out.push({ label: `${m[1]} ${y}`, season: m[1].toLowerCase(), start: r[0], end: r[1] });
  }
  // "Spring & Summer 2027", "Fall/Winter 2026": the first season shares the trailing year.
  for (const m of t.matchAll(SEASON_PAIR)) {
    const r = termRange(m[1], m[2]);
    if (r) out.push({ label: `${m[1]} ${m[2]}`, season: m[1].toLowerCase(), start: r[0], end: r[1] });
  }
  for (const m of t.matchAll(YEAR_SEASON)) {
    const r = termRange(m[2], m[1]);
    if (r) out.push({ label: `${m[2]} ${m[1]}`, season: m[2].toLowerCase(), start: r[0], end: r[1] });
  }
  for (const m of t.matchAll(ACADEMIC_YEAR)) {
    const y1 = Number(m[1]);
    const y2 = Number(m[2].length === 2 ? `20${m[2]}` : m[2]);
    if (y2 !== y1 + 1) continue;
    const ctx = t.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25);
    if (!/academic|school|\bay\b|year|term|intern|program|cohort|season/i.test(ctx)) continue;
    out.push({ label: `AY ${y1}-${y2}`, season: "academic year", start: `${y1}-08-15`, end: `${y2}-05-31` });
  }
  return out;
}

// Sentences about graduation dates are not internship terms ("graduating Spring 2028").
function termSentences(content = "") {
  return String(content).split(/(?<=[.!?;•\n])\s+/)
    .filter((s) => !/\b(graduat\w*|class of|degree completion|expected to complete|completion of (?:your|their) degree|receive (?:your|their) degree|grad date|returning to school|return to school)\b/i.test(s))
    .join(" ");
}

const overlapsWindow = (term, now, end = WINDOW_END) => term.end >= now && term.start <= end;

// Explicit end dates ("through May 2027", "ends December 2027") and start+duration.
export function explicitEndDate(content = "") {
  const t = termSentences(content);
  const dates = [];
  for (const m of t.matchAll(new RegExp(`\\b(?:through|thru|until|till|ending(?: in| on)?|ends?(?: in| on)?|end date:?|concluding(?: in)?)\\s+(?:the end of\\s+|late\\s+|early\\s+|mid[- ])?${MONTH_RE}\\.?\\s*(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s*)?(20\\d{2})`, "gi"))) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) dates.push(`${m[2]}-${String(mi + 1).padStart(2, "0")}-01`);
  }
  for (const m of t.matchAll(new RegExp(`\\bstart(?:ing|s)?(?: date)?:?\\s*(?:in|on|from)?\\s*${MONTH_RE}\\.?\\s*(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s*)?(20\\d{2})`, "gi"))) {
    const mi = monthIndex(m[1]);
    if (mi < 0) continue;
    const after = t.slice(m.index, m.index + 400);
    const dur = after.match(/\b(\d{1,2})[- ]?(?:to[- ]\d{1,2}[- ])?months?\b/i) || t.match(/\b(\d{1,2})[- ]month (?:internship|program|role|position|engagement|contract)\b/i);
    const start = new Date(Date.UTC(Number(m[2]), mi, 1));
    dates.push({ start: start.toISOString().slice(0, 10) });
    if (dur) {
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + Number(dur[1]));
      end.setUTCDate(end.getUTCDate() - 1);
      dates.push(end.toISOString().slice(0, 10));
    }
  }
  return dates;
}

// ---------- scope ----------
function scopeMatches(text, scope) {
  if (!scope || scope === "all") return true;
  try { return new RegExp(scope, "i").test(text); } catch { return true; }
}

function domainTrack(title, dept, body, firm, titleOnly = false) {
  const td = `${title} ${dept}`;
  if (firm.kind === "vc" && scoutTitle.test(title)) return "VC Scout";
  if (scoutTitle.test(title) && /\bventure|\bvc\b|startup|investment/i.test(`${td} ${body.slice(0, 1500)}`)) return "VC Scout";
  if (firm.kind === "uchicago" && /\bresearch (?:assistant|aide|associate|programmer|analyst)|\bRA\b/i.test(title)) {
    return titleOnly || raDomainBody.test(`${td} ${body}`) || !body.trim() ? "UChicago RA / Student" : null;
  }
  if (firm.kind === "uchicago" && /\bstudent\b/i.test(title)) {
    return dataTitle.test(title) || softwareTitle.test(title) || financeTitle.test(title) || /\bprogrammer|\bdeveloper|\bresearch/i.test(title) ? "UChicago RA / Student" : null;
  }
  // Title decides first; department only as a tiebreak.
  if (dataTitle.test(title) && !/\bdata entry\b/i.test(title)) return softwareTitle.test(title) && /\bsoftware|developer|swe\b/i.test(title) ? "Software" : "Data";
  if (softwareTitle.test(title)) return "Software";
  if (financeTitle.test(title)) return "Finance";
  if (genericTechTitle.test(title) || /^\s*(?:\w+\s+)?(?:20\d\d\s+)?interns?(?:hip)?\b/i.test(title)) {
    if (dataTitle.test(dept)) return "Data";
    if (softwareTitle.test(dept) || /\bengineering\b/i.test(dept)) return "Software";
    if (financeTitle.test(dept)) return "Finance";
    const hits = new Set([...String(body).slice(0, 3000).matchAll(strongSoftwareBody)].map((m) => m[1].toLowerCase()));
    if (genericTechTitle.test(title) && hits.size >= 3) return "Software";
  }
  return null;
}

// ---------- main ----------
export function classifyRole(row, firm = {}, { now = new Date().toISOString().slice(0, 10), titleOnly = false } = {}) {
  const title = String(row.Title || "").replace(/\s+/g, " ").trim();
  const dept = String(row.Department || "");
  const body = `${row.Notes || ""} ${row.Content || ""}`;
  const titleDept = `${title} ${dept}`;
  const out = (track, reason, extra = {}) => ({ track, confidence: null, reason, ...extra });
  if (!title) return out(null, "empty title");
  if (recruitingEvent.test(title)) return out(null, "recruiting event / talent pool");
  if (blockedFunction.test(title)) return out(null, "non-target function");
  if (!scopeMatches(titleDept, firm.scope)) return out(null, `outside employer scope (${firm.scope})`);
  if (firm.exclude && new RegExp(firm.exclude, "i").test(titleDept)) return out(null, "excluded program for this employer");
  if (seniority.test(title) && !studentTitle.test(title)) return out(null, "senior role");
  if (blockedEducation.test(title) && !educationAllowed.test(`${title} ${body.slice(0, 1500)}`)) return out(null, "PhD/MBA/JD-only");
  if (phdOnlyBody.test(body) && !educationAllowed.test(body.replace(phdOnlyBody, ""))) return out(null, "PhD-only (per description)");

  const isStudent = studentTitle.test(titleDept) || (studentBody.test(body) && partTimeTitle(`${title} ${row.Commitment || ""}`)) || (titleOnly && partTimeTitle(title));
  if (!isStudent) return out(null, "not a student / intern role");
  if (newGradTitle.test(title) && !/\bintern/i.test(title)) return out(null, "new-grad / full-time hire");

  const track = domainTrack(title, dept, body, firm, titleOnly);
  if (!track) return out(null, "outside software / data / finance");

  // ---- dates ----
  const titleTerms = termMentions(title);
  const bodyTerms = termMentions(termSentences(body));
  if (titleTerms.length) {
    const inWindow = titleTerms.filter((t) => overlapsWindow(t, now));
    if (!inWindow.length) {
      const startsLate = titleTerms.every((t) => t.start > WINDOW_END);
      const summerOnly = titleTerms.every((t) => t.season === "summer" || t.start > WINDOW_END);
      if (summerOnly && titleTerms.some((t) => t.season === "summer" && t.end >= now)) return out(null, "summer-only internship");
      return out(null, startsLate ? "starts after June 2027" : "dated for a past term");
    }
    if (inWindow.every((t) => t.season === "summer")) return out(null, "summer-only internship");
  } else if (bodyTerms.length) {
    const inWindow = bodyTerms.filter((t) => overlapsWindow(t, now) && t.season !== "summer");
    if (!inWindow.length) {
      if (bodyTerms.some((t) => t.season === "summer" && t.start <= "2027-08-31" && t.end >= now)) return out(null, "summer-only internship (per description)");
      if (bodyTerms.every((t) => t.end < now)) return out(null, "dated for a past term (per description)");
      if (bodyTerms.every((t) => t.start > WINDOW_END)) return out(null, "starts after June 2027 (per description)");
    }
  }
  if (/\b20(?:2[89]|3\d)\s+(?:interns?|internships?|co-?ops?|programs?)\b|\b(?:interns?|internships?|co-?ops?)\s*[-–(]?\s*20(?:2[89]|3\d)\b(?!\s*(?:grad|graduat|bachelor|class))/i.test(title) && !titleTerms.some((t) => overlapsWindow(t, now))) return out(null, "starts after June 2027");
  if (titleOnly) return { track, confidence: null, reason: "title-level checks pass" };
  for (const d of explicitEndDate(body)) {
    if (typeof d === "string" && d > WINDOW_END) return out(null, "runs past June 2027");
    if (typeof d === "object" && d.start > WINDOW_END) return out(null, "starts after June 2027");
  }

  // ---- location ----
  let loc = remoteStatus(row, firm);
  // Scout programs are campus-based or remote by nature; accept unless clearly elsewhere.
  if (!loc.ok && track === "VC Scout" && (!String(row.Location || "").trim() || chicagoPlace.test(row.Location))) loc = { ok: true, mode: "campus" };
  if (!loc.ok) return out(null, loc.reason);

  // ---- part-time vs full-time ----
  const hours = statedWeeklyHours(`${title} ${row.Commitment || ""} ${body}`);
  const commit = commitmentSignal(row.Commitment);
  const titlePT = /\bpart[- ]?time\b/i.test(title) || /\bPT\b/.test(title);
  const bodyPTRaw = partTimeBody.test(body) && !partTimeNegated.test(body);
  const negated = partTimeNegated.test(body);
  const fullTime = fullTimeTitle.test(title) || commit === "full-time" || fullTimeBody.test(body) || (hours !== null && hours >= 35);
  const term = [...new Map([...titleTerms, ...bodyTerms].filter((t) => overlapsWindow(t, now))
    .sort((x, y) => x.start.localeCompare(y.start)).map((t) => [t.label.toLowerCase(), t.label])).values()].join(", ");
  const extra = { hours, term, mode: loc.mode };

  if (track === "VC Scout") return { track, confidence: "part-time", reason: "VC scout / student venture program", evidence: "scout program", ...extra };
  if (titlePT || commit === "part-time") {
    if (hours !== null && hours > MAX_PART_TIME_HOURS && !titlePT) return out(null, `more than ${MAX_PART_TIME_HOURS} hrs/week`, extra);
    return { track, confidence: "part-time", reason: "part-time", evidence: titlePT ? "title says part-time" : `commitment: ${row.Commitment}`, ...extra };
  }
  if (hours !== null && hours <= MAX_PART_TIME_HOURS) return { track, confidence: "part-time", reason: "part-time", evidence: `${hours} hrs/week max`, ...extra };
  if (negated) return out(null, "says part-time is not available", extra);
  if (bodyPTRaw && !(fullTime && !/\bpart[- ]?time\b/i.test(body))) return { track, confidence: "part-time", reason: "part-time", evidence: (body.match(partTimeBody) || [""])[0], ...extra };
  if (fullTime) return out(null, "full-time / off-cycle co-op", extra);
  if (firm.kind === "uchicago" && /\bstudent\b/i.test(titleDept)) return { track, confidence: "part-time", reason: "UChicago student role", evidence: "student position", ...extra };
  const termTime = [...titleTerms, ...bodyTerms].some((t) => overlapsWindow(t, now) && t.season !== "summer");
  if (termTime) return { track, confidence: "hours not stated", reason: "term-time role, hours not stated", evidence: term, ...extra };
  return out(null, "no part-time or term-time signal", extra);
}

// Short human-readable note stored with each kept row.
export function roleNote(verdict) {
  return [
    verdict.confidence === "part-time" ? `part-time (${verdict.evidence})` : verdict.confidence,
    verdict.hours && !/hrs\/week/.test(verdict.evidence || "") ? `${verdict.hours} hrs/wk` : "",
    verdict.term ? `term: ${verdict.term}` : "",
    verdict.mode === "local" ? "on campus / Chicago" : verdict.mode === "campus" ? "campus program" : "fully remote",
  ].filter(Boolean).join("; ");
}

// Cheap title prefilter: which postings are worth a detail-page fetch.
export function isCandidateTitle(title = "") {
  const t = String(title);
  return (studentTitle.test(t) || /\bpart[- ]?time\b|\bPT\b|\bscout|\bresearch assistant/i.test(t))
    && !blockedFunction.test(t) && !recruitingEvent.test(t);
}
