import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { categories, sections } from '../../config/categories.mjs';

export const docsPath = 'src/content/docs';
export const utilitySlugs = new Set(['index', 'about', 'license-ai-notice']);

export async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	return (await Promise.all(entries.map(async (entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : /\.(md|mdx)$/.test(entry.name) ? [full] : [];
	}))).flat().sort();
}

export function splitSource(source) {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) throw new Error('Missing YAML frontmatter');
	return { header: match[1], body: source.slice(match[0].length) };
}

export function parseFrontmatter(source) {
	return yaml.load(splitSource(source).header, { schema: yaml.JSON_SCHEMA });
}

export async function readPages(root = process.cwd(), { validate = true } = {}) {
	const dir = path.join(root, docsPath);
	const pages = [];
	for (const file of await walk(dir)) {
		const source = await readFile(file, 'utf8');
		const data = parseFrontmatter(source);
		const slug = path.relative(dir, file).replace(/\\/g, '/').replace(/\.(md|mdx)$/, '');
		if (slug === 'index') continue;
		if (validate && !utilitySlugs.has(slug)) {
			if (slug.includes('/')) throw new Error(`Runbook path must be flat: ${slug}`);
			if (!categories.has(data.category)) throw new Error(`Unknown category for ${slug}: ${data.category}`);
		}
		if (data.slug && data.slug !== slug) throw new Error(`Use the filename as the stable slug: ${slug}`);
		pages.push({
			title: data.title, description: data.description ?? '', date: data.date ?? null,
			status: data.status ?? null, system: data.system ?? null, severity: data.severity ?? null,
			tags: data.tags ?? [], aliases: data.aliases ?? [], related: data.related ?? [],
			category: data.category ?? null,
			section: categories.get(data.category)?.section ?? null,
			slug, url: `/${slug}/`, source: path.relative(root, file).replace(/\\/g, '/'),
		});
	}
	return pages;
}

export function createSidebar(pages) {
	return [
		{ label: '開始', items: ['about', 'license-ai-notice'] },
		...sections.map((section) => ({
			label: section.label,
			collapsed: true,
			items: section.groups.map(([id, label]) => ({
				label, collapsed: true,
				items: pages.filter((p) => p.category === id).sort((a, b) => a.title.localeCompare(b.title, 'zh-TW')).map((p) => p.slug),
			})).filter((group) => group.items.length),
		})).filter((section) => section.items.length),
	];
}

export function buildRedirects(pages) {
	const canonical = new Set(pages.map((p) => p.url));
	const redirects = new Map();
	function add(from, to) {
		if (from === to || canonical.has(from.endsWith('/') ? from : `${from}/`)) {
			throw new Error(`Alias collides with a canonical URL: ${from}`);
		}
		if (redirects.has(from) && redirects.get(from) !== to) throw new Error(`Alias collision: ${from}`);
		redirects.set(from, to);
	}
	for (const page of pages) {
		for (const alias of page.aliases) {
			// Non-path aliases remain searchable keywords in debug-index.json.
			if (!alias.startsWith('/')) continue;
			if (!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\/?$/.test(alias)) throw new Error(`Invalid path alias: ${alias}`);
			const slug = alias.replace(/^\/|\/$/g, '');
			add(`/${slug}`, page.url);
			add(`/${slug}/`, page.url);
			add(`/og/${slug}.png`, `/og/${page.slug}.png`);
		}
	}
	if (redirects.size > 2000) throw new Error('Cloudflare Pages static redirect limit exceeded');
	return [...redirects].sort(([a], [b]) => a.localeCompare(b));
}
