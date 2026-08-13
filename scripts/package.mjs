#!/usr/bin/env node

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const defaultOutput = path.join(repositoryRoot, "dist", "codex-workbuddy-orchestrator-0.1.0.zip");

const EXCLUDED_NAMES = new Set([
  ".git",
  "node_modules",
  ".workbuddy-orchestrator",
  ".trae-bridge",
  "workers.local.json",
]);

function isExcluded(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_NAMES.has(part))) return true;
  if (parts.some((part) => part.toLowerCase() === "test-fixtures" || part.toLowerCase() === "test-output")) return true;
  if (normalized.startsWith("dist/")) return true;
  if (normalized.toLowerCase().endsWith(".log")) return true;
  if (normalized.toLowerCase().endsWith(".zip")) return true;
  if (normalized.includes("/workers.local.") || normalized.startsWith("workers.local.")) return true;
  return false;
}

export async function collectPackageFiles(root = repositoryRoot) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isExcluded(relative)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push({ absolute, relative: relative.replaceAll("\\", "/") });
      }
    }
  }
  await visit(path.resolve(root));
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

/** Build a ZIP archive using only Node built-ins; no package install or shell is needed. */
export async function buildZip(files, outputPath) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  const now = dosDateTime();
  for (const file of files) {
    const name = Buffer.from(file.relative, "utf8");
    const source = await readFile(file.absolute);
    const compressed = deflateRawSync(source, { level: 9 });
    const crc = crc32(source);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20), // version needed
      u16(0), // flags
      u16(8), // deflate
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(compressed.length),
      u32(source.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    localRecords.push(local);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20), // made by
      u16(20), // version needed
      u16(0),
      u16(8),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(compressed.length),
      u32(source.length),
      u16(name.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk
      u16(0), // internal attributes
      u32(0), // external attributes
      u32(offset),
      name,
    ]);
    centralRecords.push(central);
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const localData = Buffer.concat(localRecords);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(localData.length),
    u16(0),
  ]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([localData, centralDirectory, end]));
  return {
    outputPath: path.resolve(outputPath),
    fileCount: files.length,
    bytes: (await stat(outputPath)).size,
    sha256: createHash("sha256").update(await readFile(outputPath)).digest("hex"),
  };
}

export async function packageRepository({ root = repositoryRoot, output = defaultOutput } = {}) {
  const files = await collectPackageFiles(root);
  if (!files.some((file) => file.relative === "bootstrap.mjs")) throw new Error("Package is missing bootstrap.mjs");
  if (!files.some((file) => file.relative === "skill/workbuddy-orchestrator/SKILL.md")) throw new Error("Package is missing the WorkBuddy skill");
  return buildZip(files, path.resolve(output));
}

function parseArgs(argv) {
  const options = { root: repositoryRoot, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root" || token === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      options[token.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const result = await packageRepository(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
