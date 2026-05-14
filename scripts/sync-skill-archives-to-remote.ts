#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

type SkillCatalogItem = {
  id: string;
  sourcePath: string;
};

const DEFAULT_REMOTE_HOST = "root@eu-swiss";
const DEFAULT_REMOTE_DIR = "/srv/service-state/apps/zapi-stats/state/skill-archives";
const DEFAULT_CATALOG_PATH = "server/data/skills-catalog.json";
const DEFAULT_SKILLS_ROOT = "~/.codex/skills";

const TAR_EXCLUDES = [
  ".git",
  "node_modules",
  ".DS_Store",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  "auth.json",
  "cookie.json",
  "cookies.json",
  "credentials.json",
  "secrets.env",
];

function argValue(name: string, fallback: string): string {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return fallback;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

function quoteRemote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function waitFor(
  process: ChildProcessWithoutNullStreams,
  options: { drainStdout?: boolean } = {},
): Promise<{ code: number | null; stderr: string }> {
  let stderr = "";
  if (options.drainStdout) process.stdout.resume();
  process.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolveWait) => {
    process.on("close", (code) => resolveWait({ code, stderr }));
  });
}

function runSsh(host: string, command: string): string {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", host, command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`ssh failed (${result.status}): ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function runSshLive(host: string, command: string): void {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", host, command], {
    encoding: "utf8",
    stdio: ["ignore", "inherit", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`ssh failed (${result.status}): ${result.stderr}`);
  }
}

async function sendStringToRemote(host: string, remotePath: string, content: string): Promise<void> {
  const ssh = spawn("ssh", ["-o", "BatchMode=yes", host, `cat > ${quoteRemote(remotePath)}`], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let pipeError: Error | undefined;
  ssh.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") pipeError = error;
  });

  ssh.stdin.end(content);
  const result = await waitFor(ssh, { drainStdout: true });
  if (pipeError) throw new Error(`manifest upload failed: ${pipeError.message}`);
  if (result.code !== 0) throw new Error(`manifest upload failed: ${result.stderr.trim()}`);
}

async function rsyncSkillsRoot(host: string, skillsRoot: string, remoteStage: string, filesList: string): Promise<void> {
  const destination = `${host}:${remoteStage}/${basename(skillsRoot)}/`;
  const rsyncArgs = [
    "-aLr",
    "--files-from=-",
    "--human-readable",
    "--info=stats1",
    ...TAR_EXCLUDES.flatMap((pattern) => ["--exclude", pattern]),
    `${skillsRoot}/`,
    destination,
  ];

  const rsync = spawn("rsync", rsyncArgs, { stdio: ["pipe", "inherit", "pipe"] });

  let pipeError: Error | undefined;
  rsync.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") pipeError = error;
  });

  rsync.stdin.end(filesList);
  const result = await waitFor(rsync);
  if (pipeError) throw new Error(`rsync file list upload failed: ${pipeError.message}`);
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    const lines = stderr.split("\n").filter(Boolean);
    const onlyBrokenSymlinks =
      result.code === 23 &&
      lines.length > 0 &&
      lines.every((line) => line.startsWith("symlink has no referent:") || line.startsWith("rsync error: some files/attrs were not transferred"));

    if (!onlyBrokenSymlinks) {
      throw new Error(`rsync skills upload failed: ${stderr}`);
    }

    const brokenCount = lines.filter((line) => line.startsWith("symlink has no referent:")).length;
    console.warn(`rsync skipped ${brokenCount} broken symlinks`);
  }
}

function buildManifestAndFilesList(catalog: SkillCatalogItem[], skillsRoot: string) {
  const rootPrefix = skillsRoot.endsWith(sep) ? skillsRoot : `${skillsRoot}${sep}`;
  const relativePaths: string[] = [];

  const manifest = catalog
    .map((skill) => {
      if (!/^[a-z0-9._-]+$/.test(skill.id)) {
        throw new Error(`Refusing unsafe skill id: ${skill.id}`);
      }

      const sourcePath = expandHome(skill.sourcePath);
      if (!sourcePath.startsWith(rootPrefix)) {
        throw new Error(`Source path is outside skills root for ${skill.id}: ${skill.sourcePath}`);
      }
      if (!existsSync(sourcePath)) {
        throw new Error(`Missing source path for ${skill.id}: ${skill.sourcePath}`);
      }

      const relativePath = sourcePath.slice(rootPrefix.length);
      if (relativePath.includes("\t") || relativePath.includes("\n") || relativePath.startsWith("../")) {
        throw new Error(`Refusing unsafe relative path for ${skill.id}: ${relativePath}`);
      }

      relativePaths.push(relativePath);
      return `${skill.id}\t${relativePath}`;
    })
    .join("\n")
    .concat("\n");

  return {
    filesList: Array.from(new Set(relativePaths)).join("\n").concat("\n"),
    manifest,
  };
}

function buildRemotePackCommand(options: {
  manifestPath: string;
  remoteDir: string;
  remoteStage: string;
  remoteArchiveTmp: string;
  expectedCount: number;
  previousDir: string;
  stagedSkillsDirName: string;
}): string {
  const excludes = TAR_EXCLUDES.map((pattern) => `--exclude ${quoteRemote(pattern)}`).join(" ");
  const stagedSkillsRoot = `${options.remoteStage}/${options.stagedSkillsDirName}`;

  return `
set -eu
manifest=${quoteRemote(options.manifestPath)}
stage=${quoteRemote(options.remoteStage)}
staged_skills_root=${quoteRemote(stagedSkillsRoot)}
archive_tmp=${quoteRemote(options.remoteArchiveTmp)}
remote_dir=${quoteRemote(options.remoteDir)}
previous_dir=${quoteRemote(options.previousDir)}
expected_count=${options.expectedCount}

mkdir -p "$archive_tmp"
count=0
while IFS="$(printf '\\t')" read -r id rel; do
  [ -n "$id" ] || continue
  case "$id" in *[!a-z0-9._-]* ) echo "unsafe id: $id" >&2; exit 1;; esac
  case "$rel" in /*|../*|*/../* ) echo "unsafe relative path: $rel" >&2; exit 1;; esac
  src="$staged_skills_root/$rel"
  if [ ! -e "$src" ]; then echo "missing source: $src" >&2; exit 1; fi
  tar -C "$(dirname "$src")" -czhf "$archive_tmp/$id.tar.gz" ${excludes} "$(basename "$src")"
  count=$((count + 1))
  if [ $((count % 250)) -eq 0 ]; then echo "packed $count/$expected_count"; fi
done < "$manifest"

final_count="$(find "$archive_tmp" -maxdepth 1 -type f -name '*.tar.gz' | wc -l | tr -d ' ')"
if [ "$count" != "$expected_count" ] || [ "$final_count" != "$expected_count" ]; then
  echo "archive count mismatch: manifest=$count files=$final_count expected=$expected_count" >&2
  exit 1
fi

if [ -e "$previous_dir" ]; then
  echo "previous dir already exists: $previous_dir" >&2
  exit 1
fi
if [ -d "$remote_dir" ]; then mv "$remote_dir" "$previous_dir"; fi
mv "$archive_tmp" "$remote_dir"
rm -rf "$stage"
echo "remote archive count: $final_count"
`.trim();
}

async function main() {
  const remoteHost = argValue("--host", process.env.SKILLS_REMOTE_HOST ?? DEFAULT_REMOTE_HOST);
  const remoteDir = argValue("--remote-dir", process.env.SKILLS_REMOTE_DIR ?? DEFAULT_REMOTE_DIR);
  const catalogPath = resolve(argValue("--catalog", process.env.SKILLS_CATALOG_PATH ?? DEFAULT_CATALOG_PATH));
  const skillsRoot = resolve(expandHome(argValue("--skills-root", process.env.CODEX_SKILLS_ROOT ?? DEFAULT_SKILLS_ROOT)));

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as SkillCatalogItem[];
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const remoteStage = `${remoteDir}.stage-${timestamp}`;
  const remoteArchiveTmp = `${remoteDir}.next-${timestamp}`;
  const previousDir = `${remoteDir}.prev-${timestamp}`;
  const manifestPath = `${remoteStage}/skills-manifest.tsv`;

  console.log(`syncing ${catalog.length} skills from ${skillsRoot} to ${remoteHost}:${remoteDir}`);
  const { filesList, manifest } = buildManifestAndFilesList(catalog, skillsRoot);

  runSsh(remoteHost, `set -e; mkdir -p ${quoteRemote(`${remoteStage}/${basename(skillsRoot)}`)} ${quoteRemote(remoteArchiveTmp)}`);
  console.log("uploading manifest");
  await sendStringToRemote(remoteHost, manifestPath, manifest);

  console.log("rsyncing catalog skill directories to remote staging");
  await rsyncSkillsRoot(remoteHost, skillsRoot, remoteStage, filesList);

  console.log("packing per-skill archives on remote");
  runSshLive(
    remoteHost,
    buildRemotePackCommand({
      expectedCount: catalog.length,
      manifestPath,
      previousDir,
      remoteArchiveTmp,
      remoteDir,
      remoteStage,
      stagedSkillsDirName: basename(skillsRoot),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
