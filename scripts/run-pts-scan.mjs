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

function run(script, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(scriptDir, script), ...args], { cwd: rootDir, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${script} exited with code ${code}`))));
  });
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
if (shouldPublish) await run("publish_scan_results.mjs");

console.log("");
console.log("Done. Generated CSV, Markdown, raw JSON, and audit JSON files in:");
console.log(rootDir);
