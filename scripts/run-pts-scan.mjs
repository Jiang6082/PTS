// PTS orchestrator.  node scripts/run-pts-scan.mjs --mode=all [--publish] [--no-web]
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const validModes = new Set(["v1", "v2", "all"]);
const userArgs = process.argv.slice(2);
const modeArg = userArgs.find((arg) => arg.startsWith("--mode="));
const positionalMode = userArgs.find((arg) => !arg.startsWith("-"));
const mode = modeArg ? modeArg.split("=")[1] : positionalMode || "all";
const shouldPublish = userArgs.includes("--publish") || process.env.PTS_AUTO_PUBLISH === "1";
const passThrough = userArgs.filter((a) => a === "--no-web");

if (!validModes.has(mode)) {
  console.error(`Invalid mode: ${mode}`);
  console.error("Use one of: v1, v2, all");
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const stateDir = resolve(rootDir, ".scan-state");
const previousRunFile = resolve(stateDir, "previous_scan_time.txt");
const v2RawPath = resolve(rootDir, "data/pts_roles_scan_v2_raw.json");
const previousV2RawPath = resolve(stateDir, "previous_pts_v2_raw.json");

await fs.mkdir(stateDir, { recursive: true });
await fs.mkdir(resolve(rootDir, "reports"), { recursive: true });
await fs.mkdir(resolve(rootDir, "data"), { recursive: true });

if (["v2", "all"].includes(mode)) {
  try {
    await fs.copyFile(v2RawPath, previousV2RawPath);
    const raw = JSON.parse(await fs.readFile(v2RawPath, "utf8"));
    if (raw.searchedAt) await fs.writeFile(previousRunFile, raw.searchedAt);
  } catch {}
}

// Each step's output is echoed and its last lines kept, so a failing step is recorded in
// reports/SCAN_ERRORS.md (committed with the results) instead of only in the Actions log.
const errors = [];
function runStep(script, args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(scriptDir, script), ...args], { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    const tail = [];
    const keep = (chunk, stream) => {
      stream.write(chunk);
      tail.push(...String(chunk).split("\n").filter((l) => l && !/ \d+\/\d+$/.test(l)));
      if (tail.length > 40) tail.splice(0, tail.length - 40);
    };
    child.stdout.on("data", (c) => keep(c, process.stdout));
    child.stderr.on("data", (c) => keep(c, process.stderr));
    child.on("error", (e) => { errors.push({ script, code: "spawn", tail: [String(e)] }); resolvePromise(false); });
    child.on("close", (code) => {
      if (code !== 0) errors.push({ script, code, tail: tail.slice(-30) });
      resolvePromise(code === 0);
    });
  });
}
async function run(script, args = []) {
  const ok = await runStep(script, args);
  if (!ok) console.error(`!! ${script} failed; continuing so results and the error log still publish`);
  return ok;
}

console.log(`Using Node: ${process.execPath}`);
console.log(`Running scan mode: ${mode}`);

await run("scan_pts_boards.mjs");
await run("fix_icims_locations.mjs");
if (["v2", "all"].includes(mode)) {
  await run("expand_pts_search.mjs", passThrough);
  await run("build_pts_roster_scan_audit.mjs");
  await run("build_new_pts_roles_report.mjs");
  await run("build_verified_roles.mjs");
  await run("build_scan_dashboard.mjs");
  await run("build-readme.mjs");
}
const errorReport = resolve(rootDir, "reports/SCAN_ERRORS.md");
if (errors.length) {
  const md = ["# Scan errors", "", `Run: ${new Date().toISOString()}`, "",
    ...errors.flatMap((e) => [`## ${e.script} (exit ${e.code})`, "", "```", ...e.tail, "```", ""])].join("\n");
  await fs.writeFile(errorReport, md, "utf8");
} else {
  await fs.rm(errorReport, { force: true });
}
if (shouldPublish) {
  const published = await runStep("publish_scan_results.mjs");
  if (!published) console.error(errors.at(-1)?.tail.join("\n"));
}
if (errors.length) {
  console.error(`\n${errors.length} step(s) failed: ${errors.map((e) => e.script).join(", ")}`);
  process.exit(1);
}

console.log("");
console.log("Done. Generated CSV, Markdown, raw JSON, and audit JSON files in:");
console.log(rootDir);
