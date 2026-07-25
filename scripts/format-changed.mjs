#!/usr/bin/env node
/**
 * CI formatter gate for files changed by the checked-out revision.
 * `npm run format:full-debt` intentionally keeps the repository-wide debt visible.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const base = normalizedSha(process.env.FORMAT_BASE_SHA);
const head = normalizedSha(process.env.FORMAT_HEAD_SHA) ?? "HEAD";
const files = changedFiles(base, head).filter((file) => existsSync(resolve(file)));

if (files.length === 0) {
  console.log("No changed files require Prettier validation.");
  process.exit(0);
}

const prettierBin = resolve("node_modules", "prettier", "bin", "prettier.cjs");
await run(process.execPath, [prettierBin, "--check", "--ignore-unknown", ...files]);

function changedFiles(baseRevision, headRevision) {
  if (baseRevision !== undefined && canResolveRevision(baseRevision)) {
    return git(["diff", "--name-only", "--diff-filter=ACMR", baseRevision, headRevision]);
  }
  return git(["diff-tree", "--no-commit-id", "--name-only", "-r", headRevision]);
}

function normalizedSha(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[0-9a-f]{40}$/i.test(normalized) && !/^0{40}$/i.test(normalized)
    ? normalized
    : undefined;
}

function canResolveRevision(revision) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${exitCode ?? "unknown"}`));
      }
    });
  });
}
