import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsDir = path.join(root, 'src/content/docs');
const publicDir = path.join(root, 'public');
const indexPath = path.join(publicDir, 'debug-index.json');

const scalarKeys = new Set(['title', 'description', 'date', 'status', 'system', 'severity']);
const arrayKeys = new Set(['tags', 'aliases', 'related']);

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return walk(fullPath);
			if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) return [fullPath];
			return [];
		})
	);
	return files.flat();
}

function parseFrontmatter(source) {
	if (!source.startsWith('---\n')) return {};
	const end = source.indexOf('\n---', 4);
	if (end === -1) return {};
	const lines = source.slice(4, end).split('\n');
	const data = {};
	let currentArrayKey = null;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;

		const item = line.match(/^\s+-\s+(.*)$/);
		if (item && currentArrayKey) {
			data[currentArrayKey].push(unquote(item[1].trim()));
			continue;
		}

		const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!pair) {
			currentArrayKey = null;
			continue;
		}

		const [, key, rawValue] = pair;
		currentArrayKey = null;
		if (arrayKeys.has(key)) {
			data[key] = [];
			if (rawValue.trim()) data[key].push(unquote(rawValue.trim()));
			currentArrayKey = key;
			continue;
		}
		if (scalarKeys.has(key)) data[key] = unquote(rawValue.trim());
	}

	return data;
}

function unquote(value) {
	return value.replace(/^['"]|['"]$/g, '');
}

function slugFor(file) {
	const relative = path.relative(docsDir, file).replace(/\\/g, '/').replace(/\.(md|mdx)$/, '');
	if (relative === 'index') return '';
	return relative.replace(/\/index$/, '');
}

function urlFor(slug) {
	return `/${slug ? `${slug}/` : ''}`;
}

const files = await walk(docsDir);
const pages = [];

for (const file of files.sort()) {
	const source = await readFile(file, 'utf8');
	const frontmatter = parseFrontmatter(source);
	if (!frontmatter.title || slugFor(file) === '') continue;
	const slug = slugFor(file);
	pages.push({
		title: frontmatter.title,
		description: frontmatter.description ?? '',
		date: frontmatter.date ?? null,
		status: frontmatter.status ?? null,
		system: frontmatter.system ?? null,
		severity: frontmatter.severity ?? null,
		tags: frontmatter.tags ?? [],
		aliases: frontmatter.aliases ?? [],
		related: frontmatter.related ?? [],
		slug,
		url: urlFor(slug),
		source: path.relative(root, file).replace(/\\/g, '/'),
	});
}

const index = {
	count: pages.length,
	pages,
};

await mkdir(publicDir, { recursive: true });
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, indexPath)} with ${pages.length} pages.`);
