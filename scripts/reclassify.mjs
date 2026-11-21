import { readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { classify, categories } from '../config/categories.mjs';
import { docsPath, utilitySlugs, walk, splitSource, parseFrontmatter, buildRedirects } from './lib/content.mjs';

// Replace only actual site links. Never rewrite unrelated URLs, code or aliases.
export function rewriteLinks(body, moves) {
	return body.replace(/(\]\(<?|^\s*\[[^\]]+\]:\s*<?)(https:\/\/debug\.giveanornot\.com)?\/([a-z0-9_/-]+)(?=[#?\s)>])/gm,
		(match, prefix, origin, raw) => {
			const target = moves.get(raw.replace(/\/$/, ''));
			return target ? `${prefix}${origin ?? ''}/${target}/` : match;
		});
}

export async function migrate(root = process.cwd(), { write = false } = {}) {
	const dir = path.join(root, docsPath);
	const plans = [];
	const moves = new Map();
	const targets = new Set();
	for (const file of await walk(dir)) {
		const relative = path.relative(dir, file).replace(/\\/g, '/');
		const oldSlug = relative.replace(/\.(md|mdx)$/, '');
		if (utilitySlugs.has(oldSlug)) continue;
		const slug = path.basename(oldSlug);
		if (utilitySlugs.has(slug)) throw new Error(`Reserved slug: ${slug}`);
		const source = await readFile(file, 'utf8');
		const data = parseFrontmatter(source);
		const category = data.category ?? classify(slug);
		if (!categories.has(category)) throw new Error(`Unknown category: ${category}`);
		const target = path.join(dir, path.basename(file));
		if (targets.has(target)) throw new Error(`Duplicate flat slug: ${slug}`);
		targets.add(target);
		if (file !== target) {
			try { await access(target); throw new Error(`Target already exists: ${target}`); }
			catch (error) { if (error.code !== 'ENOENT') throw error; }
			moves.set(oldSlug, slug);
		}
		plans.push({ file, target, oldSlug, slug, source, data, category });
	}
	// Fully validate all proposed aliases before touching any file.
	const proposed = plans.map((plan) => ({
		...plan, url: `/${plan.slug}/`,
		aliases: [...new Set([...(plan.data.aliases ?? []), ...(plan.oldSlug !== plan.slug ? [`/${plan.oldSlug}/`] : [])])],
	}));
	buildRedirects([
		...proposed,
		...['about', 'license-ai-notice'].map((slug) => ({ slug, url: `/${slug}/`, aliases: [] })),
	]);
	let changed = 0;
	for (const plan of proposed) {
		const parts = splitSource(plan.source);
		let header = parts.header;
		if (!plan.data.category) header += `\ncategory: ${plan.category}`;
		if (plan.aliases.length !== (plan.data.aliases ?? []).length) {
			const block = yaml.dump({ aliases: plan.aliases }, { lineWidth: -1 }).trimEnd();
			const re = /^aliases:[^\n]*(?:\n[ \t]+[^\n]*)*/m;
			header = /^aliases:/m.test(header) ? header.replace(re, block) : `${header}\n${block}`;
		}
		if (plan.data.related?.some((item) => moves.has(item.replace(/^\/|\/$/g, '')))) {
			const related = plan.data.related.map((item) => moves.get(item.replace(/^\/|\/$/g, '')) ?? item);
			header = header.replace(/^related:[^\n]*(?:\n[ \t]+[^\n]*)*/m,
				yaml.dump({ related }, { lineWidth: -1 }).trimEnd());
		}
		const updated = `---\n${header}\n---\n${rewriteLinks(parts.body, moves)}`;
		if (updated !== plan.source || plan.file !== plan.target) {
			changed++;
			if (write) {
				await writeFile(plan.file, updated);
				if (plan.file !== plan.target) await rename(plan.file, plan.target);
			}
		}
	}
	const counts = Object.fromEntries([...categories].map(([id]) => [id, proposed.filter((p) => p.category === id).length]).filter(([, n]) => n));
	return { mode: write ? 'write' : 'dry-run', runbooks: plans.length, moved: moves.size, changed, counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.slice(2).some((arg) => arg !== '--write')) throw new Error('Usage: npm run reclassify -- [--write]');
	console.log(JSON.stringify(await migrate(process.cwd(), { write: process.argv.includes('--write') }), null, 2));
}
