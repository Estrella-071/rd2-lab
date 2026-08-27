import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = [
  'README.md',
  'CONTRIBUTING.md',
  'MAINTAINER_GUIDE.md',
  'ARCHITECTURE.md',
  'DATA_MODEL.md',
  'REPRODUCING.md',
  'TESTING.md',
  'PERFORMANCE.md',
  'DEPLOYMENT.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'GOVERNANCE.md',
  'NOTICE.md',
  'CHANGELOG.md',
  'site/README.md',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/data_correction.md',
  '.github/ISSUE_TEMPLATE/documentation.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
];
const errors = [];
const linkPattern = /\]\(([^)\s]+)/g;
const workflowLinkPattern = /github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/workflows\/([\w.%-]+)/gi;

function githubRepositoryKey(value) {
  const source = String(value || "").trim();
  const marker = source.toLowerCase().indexOf("github.com");
  if (marker < 0) return null;
  let suffix = source.slice(marker + "github.com".length);
  if (suffix.startsWith(":") || suffix.startsWith("/")) suffix = suffix.slice(1);
  const parts = suffix.split(/[\s/?#]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const repository = parts[1].endsWith(".git") ? parts[1].slice(0, -4) : parts[1];
  return `${parts[0].toLowerCase()}/${repository.toLowerCase()}`;
}

const gitConfigPath = path.join(rootDir, '.git', 'config');
const gitConfig = fs.existsSync(gitConfigPath) ? fs.readFileSync(gitConfigPath, 'utf8') : '';
const originSectionStart = gitConfig.indexOf('[remote "origin"]');
const nextSectionStart = originSectionStart < 0 ? -1 : gitConfig.indexOf("\n[", originSectionStart + 1);
let originSection = "";
if (originSectionStart >= 0) {
  const originSectionEnd = nextSectionStart < 0 ? gitConfig.length : nextSectionStart;
  originSection = gitConfig.slice(originSectionStart, originSectionEnd);
}
const originUrl = originSection.split("\n")
  .map((line) => line.trim())
  .find((line) => line.startsWith("url = "))?.slice(6).trim() || '';
const localRepositoryKey = githubRepositoryKey(originUrl);

for (const relativeDoc of docs) {
  const docPath = path.join(rootDir, relativeDoc);
  if (!fs.existsSync(docPath)) {
    errors.push(`${relativeDoc} is missing`);
    continue;
  }
  const text = fs.readFileSync(docPath, 'utf8');
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1];
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const cleanTarget = target.split('#', 1)[0].split('?', 1)[0];
    if (!cleanTarget) continue;
    const resolved = path.resolve(path.dirname(docPath), cleanTarget);
    if (!resolved.startsWith(rootDir + path.sep) || !fs.existsSync(resolved)) {
      errors.push(`${relativeDoc} -> ${target}`);
    }
  }
  if (localRepositoryKey) {
    for (const match of text.matchAll(workflowLinkPattern)) {
      const targetRepositoryKey = `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
      if (targetRepositoryKey !== localRepositoryKey) continue;
      const workflowFile = decodeURIComponent(match[3]);
      const workflowPath = path.join(rootDir, '.github', 'workflows', workflowFile);
      if (!/^[A-Za-z0-9._-]+$/.test(workflowFile) || !fs.existsSync(workflowPath)) {
        errors.push(`${relativeDoc} -> ${match[0]} (workflow file missing)`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Documentation link check failed (${errors.length} issue(s)):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Documentation link check passed for ${docs.length} required documents.`);
