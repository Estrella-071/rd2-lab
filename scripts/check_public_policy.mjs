#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitExecutable = (
  process.platform === "win32"
    ? [String.raw`C:\Program Files\Git\cmd\git.exe`, String.raw`C:\Program Files\Git\bin\git.exe`]
    : ["/usr/bin/git"]
).find((candidate) => fs.existsSync(candidate));

if (!gitExecutable) {
  throw new Error("Git was not found in a system-managed installation directory.");
}

const gitResult = spawnSync(
  gitExecutable,
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: rootDir, encoding: "utf8" }
);
if (gitResult.status !== 0) {
  throw new Error(`Unable to enumerate repository files: ${gitResult.stderr.trim()}`);
}

const publicFiles = gitResult.stdout
  .split(/\r?\n/)
  .filter(Boolean);

const word = (...codes) => String.fromCodePoint(...codes);
const forbidden = [
  word(99, 111, 100, 101, 120),
  word(97, 110, 116, 105, 103, 114, 97, 118, 105, 116, 121),
  word(103, 112, 116),
  word(103, 101, 109, 105, 110, 105),
];
const oldRepository = ["random", "dice", "2", "tree"].join("-");
const languageLabel = word(32321, 39636, 20013, 25991);
const termA = word(65, 110, 100, 114, 111, 105, 100);
const termB = word(105, 111, 115);
const termC = word(114, 101, 115, 101, 97, 114, 99, 104);
const termD = word(101, 120, 116, 114, 97, 99, 116, 105, 111, 110, 95, 114, 111, 111, 116);
const termE = word(101, 120, 116, 114, 97, 99, 116, 101, 100);
const termF = word(114, 101, 115, 111, 117, 114, 99, 101, 115, 46, 97, 115, 115, 101, 116, 115);
const termG = word(105, 112, 97);
const termH = word(97, 112, 107);
const termI = word(35282, 21253);
const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const errors = [];

for (const relativePath of publicFiles) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) continue;
  if (/\.png$/i.test(relativePath)) continue;
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  const lower = text.toLowerCase();

  for (const term of forbidden) {
    if (lower.includes(term)) errors.push(`${relativePath}: forbidden provider marker`);
  }
  if (lower.includes(oldRepository)) errors.push(`${relativePath}: old repository slug`);
  if (text.includes(languageLabel)) errors.push(`${relativePath}: locale branding phrase`);

  const isDependencyMetadata = relativePath === "package-lock.json" || relativePath === "npm-shrinkwrap.json";
  const publicProcessPatterns = [
    ...(isDependencyMetadata ? [] : [
      { value: termA, label: "mobile platform marker" },
      { value: termB, label: "mobile platform marker" },
    ]),
    { value: termC, label: "private path or label" },
    { value: termD, label: "restricted path" },
    { value: termE, label: "private artifact" },
    { value: termF, label: "private asset container" },
    { value: termG, label: "private package marker" },
    { value: termH, label: "private package marker" },
    { value: termI, label: "restricted artifact" }
  ];
  for (const { value, label } of publicProcessPatterns) {
    const isShortMarker = value === termA || value === termB || value === termG || value === termH;
    const matches = isShortMarker ? new RegExp(String.raw`\b${value}\b`, "i").test(lower) : lower.includes(value.toLowerCase());
    if (matches) {
      errors.push(`${relativePath}: ${label}`);
    }
  }

  if (relativePath.endsWith(".md") && emojiPattern.test(text)) {
    errors.push(`${relativePath}: emoji in Markdown`);
  }

  if (relativePath === "site/data/changelog.json" || relativePath === "src/ui/changelog_view.js" || relativePath === "CHANGELOG.md") {
    if (lower.includes(termA.toLowerCase()) || lower.includes(termB.toLowerCase())) errors.push(`${relativePath}: platform name in public changelog`);
  }
}

const required = [
  ["README.md", "Random Dice 2 Lab"],
  ["package.json", '"name": "rd2-lab"'],
  ["site/index.html", "https://rd2-lab.pages.dev/"],
];
for (const [relativePath, expected] of required) {
  const text = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  if (!text.includes(expected)) errors.push(`${relativePath}: missing public identity ${expected}`);
}

if (errors.length > 0) {
  console.error(`Public policy check failed (${errors.length} issue(s)):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Public policy check passed for ${publicFiles.length} public files.`);
