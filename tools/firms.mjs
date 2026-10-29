// Loads the PTS employer universe (inputs/pts_employer_roster.json) and hand-seeded ATS boards
// (inputs/ats_seeds.json), and generates candidate ATS slugs for firms without seeds.
import fs from "node:fs/promises";

export async function loadRoster(path = "inputs/pts_employer_roster.json") {
  const roster = JSON.parse(await fs.readFile(path, "utf8"));
  const byName = new Map();
  for (const firm of roster.companies) {
    const name = roster.aliases?.[firm.name] || firm.name;
    if (!byName.has(name)) byName.set(name, { scope: "all", ...firm, name });
  }
  return { roster, firms: [...byName.values()], byName };
}

export async function loadSeeds(path = "inputs/ats_seeds.json") {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")).firms || {};
  } catch {
    return {};
  }
}

const GENERIC = new Set([
  "the", "and", "of", "group", "associates", "consulting", "consultants", "economic", "economics",
  "research", "partners", "advisors", "advisory", "analytics", "international", "global", "llc", "inc",
  "company", "solutions", "services", "management", "capital", "energy", "health", "policy", "market",
  "markets", "analysis", "economists", "strategy", "planning", "institute", "center", "centre", "financial", "data", "science",
  "labs", "lab", "ai", "technologies", "technology", "software", "systems", "ventures", "venture", "fund", "investments",
  "trading", "securities", "bank", "university", "foundation", "network", "media", "health", "insurance", "careers",
]);

// Conservative slug guesses: full name joined/hyphenated, plus the name with a trailing
// generic suffix removed when what is left is still distinctive. Parenthetical qualifiers
// are dropped. (Single-first-word guesses are deliberately avoided: they collide with
// unrelated companies' boards.)
export function generatedTokens(name) {
  const base = name.replace(/\(.*?\)/g, " ").toLowerCase().replace(/&/g, "and").replace(/\+/g, " ");
  const words = base.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const noThe = words[0] === "the" ? words.slice(1) : words;
  const variants = new Set([
    noThe.join(""),
    noThe.join("-"),
    words.join(""),
    noThe.filter((w) => !["llc", "inc", "the"].includes(w)).join(""),
  ]);
  const stripped = noThe.join("").replace(/(capitalmanagement|assetmanagement|venturepartners|technologies|consulting|group|associates|partners|advisors|capital|ventures|labs|ai|inc)$/, "");
  if (stripped.length >= 5 && !GENERIC.has(stripped)) variants.add(stripped);
  return [...variants].filter((v) => v && v.length >= 3 && !GENERIC.has(v));
}
