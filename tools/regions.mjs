export const regionOrder = [
  "North America",
  "Europe",
  "Asia",
  "Oceania",
  "Middle East",
  "South America",
  "Africa",
  "Global / Multiple Regions",
  "Remote / Unspecified",
];

const patterns = {
  "North America": /\b(?:united states|u\.?s\.?a?|americas?|amers|canada|mexico|new york|chicago|boston|miami|greenwich|houston|austin|stamford|san francisco|los angeles|washington|jersey city|philadelphia|montreal|toronto|vancouver|calgary|ottawa|camden|hanover|connecticut|illinois|massachusetts|california|texas|florida|new jersey|pennsylvania|virginia|maryland|wisconsin|georgia|colorado|oregon|minnesota|michigan|ohio|north carolina|district of columbia|washington,? d\.?c\.?|cambridge,? ma|emeryville|oakland|berkeley|menlo park|palo alto|san jose|seattle|denver|dallas|atlanta|arlington|bethesda|rockville|sacramento|san diego|portland|raleigh|durham|minneapolis|detroit|tampa|orlando|burlingame|madison|marlborough|amherst|princeton|baltimore|pittsburgh|cleveland|st\.? louis|phoenix|salt lake city|nashville|charlotte|richmond|reston|mclean|nyc|n\.y\.|ct|il|ma|ca|tx|fl|nj|pa|dc|va|md|wi|mn|nc|mi|ga)\b/i,
  "Europe": /\b(?:europe|emea|united kingdom|u\.?k\.?|england|ireland|france|germany|netherlands|switzerland|poland|spain|italy|sweden|norway|denmark|finland|austria|belgium|czech|romania|hungary|slovakia|portugal|london|paris|zurich|dublin|amsterdam|geneva|berlin|munich|frankfurt|warsaw|krakow|prague|madrid|milan|stockholm|oslo|copenhagen|helsinki|vienna|brussels|budapest|bucharest|lisbon|bristol|bratislava|brussels|oxford|belfast|edinburgh|glasgow|manchester|leeds|birmingham|rome|luxembourg|bad honnef|olten|bern|basel|lausanne|athens|cologne|düsseldorf|dusseldorf|hamburg|rotterdam|the hague|utrecht|aarhus|gothenburg|turin|barcelona|lyon|scotland|wales|northern ireland|belgium)\b/i,
  "Asia": /\b(?:asia|apac|apej|singapore|hong kong|china|japan|india|taiwan|south korea|korea|vietnam|thailand|malaysia|indonesia|philippines|beijing|shanghai|shenzhen|tokyo|seoul|mumbai|bengaluru|bangalore|hyderabad|ho chi minh|hanoi|kuala lumpur)\b/i,
  "Oceania": /\b(?:oceania|australia|new zealand|sydney|melbourne|brisbane|perth|auckland|wellington|canberra|adelaide|christchurch)\b/i,
  "Middle East": /\b(?:middle east|uae|u\.a\.e\.|united arab emirates|dubai|abu dhabi|israel|tel aviv|saudi arabia|qatar|bahrain|kuwait)\b/i,
  "South America": /\b(?:south america|latin america|latam|brazil|argentina|chile|colombia|peru|uruguay|sao paulo|buenos aires|santiago|bogota)\b/i,
  "Africa": /\b(?:africa|south africa|egypt|morocco|nigeria|kenya|johannesburg|cape town|cairo|lagos|nairobi)\b/i,
};

export function regionForLocation(location = "") {
  const value = String(location).replace(/\s+/g, " ").trim();
  const matched = Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(value))
    .map(([region]) => region);
  if (matched.length > 1) return "Global / Multiple Regions";
  if (matched.length === 1) return matched[0];
  return "Remote / Unspecified";
}

// PTS reports group roles by track (they are almost all remote, so region adds little).
export const trackOrder = ["Software", "Data", "Finance", "VC Scout", "UChicago RA / Student"];

export function rowsByTrack(rows) {
  const grouped = new Map(trackOrder.map((t) => [t, []]));
  for (const row of rows) {
    const t = row.Track || "Other";
    if (!grouped.has(t)) grouped.set(t, []);
    grouped.get(t).push(row);
  }
  return grouped;
}

export function rowsByRegion(rows) {
  const grouped = new Map(regionOrder.map((region) => [region, []]));
  for (const row of rows) grouped.get(regionForLocation(row.Location)).push(row);
  return grouped;
}

export function roleMarkdown(row) {
  const notes = row.Notes ? `: ${String(row.Notes).slice(0, 240)}` : "";
  return `- **${row.Company}** - [${row.Title}](${row.URL})${row.Location ? ` - ${row.Location}` : ""} - ${row.Status || ""} (${row.Source || ""})${notes}`;
}

export function groupedRoleMarkdown(rows, emptyText = "_None._") {
  const grouped = rowsByTrack(rows);
  return [...grouped.keys()].flatMap((track) => {
    const list = grouped.get(track);
    if (!list.length && !trackOrder.includes(track)) return [];
    return [
      `### ${track} (${list.length})`,
      "",
      list.length ? list.map(roleMarkdown).join("\n") : emptyText,
      "",
    ];
  });
}
