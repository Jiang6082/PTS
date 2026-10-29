import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${details ? `\n${details}` : ""}`);
  }
  return result.stdout.trim();
}

function maybeRun(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  };
}

const branch = run("git", ["branch", "--show-current"]) || "main";
const statusBefore = run("git", ["status", "--porcelain"]);
if (!statusBefore) {
  console.log("publish: no changes to commit");
  process.exit(0);
}

const auth = maybeRun("gh", ["auth", "status"]);
if (!auth.ok) {
  throw new Error(`GitHub CLI is not authenticated. Run gh auth login, then retry.\n${auth.output}`);
}

run("git", ["add", "-A"]);
const staged = run("git", ["diff", "--cached", "--name-only"]);
if (!staged) {
  console.log("publish: no staged changes");
  process.exit(0);
}

const now = new Date().toISOString().slice(0, 10);
const shortSha = maybeRun("git", ["rev-parse", "--short", "HEAD"]).output || "";
const message = `Update scan results ${now}`;

const commit = maybeRun("git", ["commit", "-m", message]);
if (!commit.ok && !/nothing to commit/i.test(commit.output)) {
  throw new Error(commit.output);
}

run("git", ["push", "-u", "origin", branch]);
console.log(`publish: pushed ${branch}${shortSha ? ` from ${shortSha}` : ""}`);
