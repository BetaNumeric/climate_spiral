import { appendFileSync, readFileSync } from 'node:fs';
import { videoMonth } from './readme-video.mjs';

const month = new Date().toISOString().slice(0, 7);
const previous = videoMonth(readFileSync('README.md', 'utf8'));
const due = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || previous !== month;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `render=${due}\n`);
console.log(due ? `Rendering README videos for ${month}.` : `README videos were already updated in ${month}.`);
