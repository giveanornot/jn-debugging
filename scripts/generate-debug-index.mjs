import { mkdir, writeFile } from 'node:fs/promises';
import { readPages, buildRedirects } from './lib/content.mjs';

const pages = await readPages();
const redirects = buildRedirects(pages);
await mkdir('public', { recursive: true });
await writeFile('public/debug-index.json', `${JSON.stringify({ count: pages.length, pages }, null, 2)}\n`);
await writeFile('public/_redirects', '# Generated from frontmatter path aliases by npm run index.\n' +
	redirects.map(([from, to]) => `${from} ${to} 301`).join('\n') + '\n');
console.log(`Wrote index with ${pages.length} pages and ${redirects.length} permanent redirects.`);
