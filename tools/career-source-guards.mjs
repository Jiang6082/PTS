// Career pages that web discovery tends to mis-attribute to a roster employer
// (same name, different company). Add entries as they show up in the audit.
const knownWrongSources = new Map([
  ["Hex", /hex\.com|hexcel|hexagon/i],
  ["Modal", /modalert|modalyst/i],
  ["Linear", /linear\.(?:com|technology)/i],
  ["Sierra", /sierra(?:club|nevada|\.com)/i],
  ["Exa", /exactsciences|exasol/i],
]);

export function isKnownWrongCareerPage(company, url = "") {
  return knownWrongSources.get(company)?.test(url) || false;
}
