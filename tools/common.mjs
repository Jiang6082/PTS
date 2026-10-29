// Shared helpers used by every PTS scanner/report script.
export const USER_AGENT = "Mozilla/5.0 (compatible; PTS part-time internship scanner)";

const NAMED_ENTITIES = {
  eacute: "é", Eacute: "É", egrave: "è", Egrave: "È", ecirc: "ê", euml: "ë", agrave: "à", Agrave: "À", acirc: "â", aacute: "á",
  auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", oacute: "ó", ocirc: "ô", iacute: "í", icirc: "î", ccedil: "ç",
  Ccedil: "Ç", ntilde: "ñ", szlig: "ß", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", bull: "•", middot: "·",
  trade: "™", reg: "®", copy: "©", euro: "€", pound: "£",
};

export function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&mdash;|&#8212;/g, "-")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtml(value = "") {
  return decodeHtml(
    decodeHtml(value)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export async function fetchText(url, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
        ...headers,
      },
    });
    return { ok: res.ok, status: res.status, text: await res.text(), url: res.url || url };
  } catch (error) {
    return { ok: false, status: 0, text: "", url, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url, options = {}) {
  const res = await fetchText(url, { ...options, headers: { accept: "application/json", ...(options.headers || {}) } });
  if (!res.ok) return null;
  try { return JSON.parse(res.text); } catch { return null; }
}

export async function postJson(url, payload, options = {}) {
  return fetchJson(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload ?? {}),
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
}

export async function mapLimit(items, limit, fn, label = "processed") {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      done += 1;
      if (done % 20 === 0) console.error(`${label} ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function toCsv(rows, headers) {
  return [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n");
}

// RFC-4180-ish parser that handles quoted commas and newlines.
export function parseCsv(text = "") {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { record.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      if (record.some(Boolean)) records.push(record);
      record = []; field = "";
    } else field += ch;
  }
  if (field || record.length) { record.push(field); if (record.some(Boolean)) records.push(record); }
  if (!records.length) return [];
  const headers = records[0];
  return records.slice(1).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}

export function hostOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
