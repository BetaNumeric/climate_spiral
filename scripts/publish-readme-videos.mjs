import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateReadmeVideos } from './readme-video.mjs';

const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error('GITHUB_REPOSITORY must identify the destination repository.');
}
if (!process.env.GH_TOKEN) throw new Error('README_VIDEO_TOKEN is required to upload GitHub video attachments.');
const metadata = JSON.parse(readFileSync('readme-videos/selection.json', 'utf8'));
const issueTitle = 'Automated README preview videos';
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const issues = JSON.parse(gh([
  'issue', 'list', '-R', repository, '--state', 'all', '--search', `"${issueTitle}" in:title`,
  '--json', 'number,title', '--limit', '100',
]));
let issueNumber = issues.find(issue => issue.title === issueTitle)?.number;
if (!issueNumber) {
  const issueUrl = gh([
    'issue', 'create', '-R', repository, '--title', issueTitle,
    '--body', 'This issue stores the current video attachments used by README.md. It is updated by the monthly video workflow.',
  ]);
  issueNumber = Number(issueUrl.match(/\/issues\/(\d+)\s*$/)?.[1]);
  if (!issueNumber) throw new Error(`Could not determine the media issue number: ${issueUrl}`);
}

const top = join('readme-videos', 'temperature.mp4');
const bottom = join('readme-videos', `${metadata.secondary.key}.mp4`);
const issueBodyPath = join('readme-videos', 'issue-body.md');
writeFileSync(issueBodyPath, `README videos for ${metadata.month}.\n\nGlobal Temperature\n\n![](${top})\n\n${metadata.secondary.title}\n\n![](${bottom})\n`);
gh(['issue', 'edit', String(issueNumber), '-R', repository, '--body-file', issueBodyPath,
  '--attach', top, '--attach', bottom]);

const issueBody = JSON.parse(gh(['issue', 'view', String(issueNumber), '-R', repository, '--json', 'body'])).body;
const urls = [...issueBody.matchAll(/https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+/gi)]
  .map(match => match[0]);
if (urls.length !== 2 || urls[0] === urls[1]) {
  throw new Error(`Expected two distinct GitHub video attachments in issue #${issueNumber}.`);
}

const readme = readFileSync('README.md', 'utf8');
const updated = updateReadmeVideos(readme, {
  topUrl: urls[0], bottomUrl: urls[1], dataset: metadata.secondary, month: metadata.month,
});
writeFileSync('README.md', updated);
console.log(`Updated README video URLs from issue #${issueNumber}: temperature and ${metadata.secondary.title}.`);
