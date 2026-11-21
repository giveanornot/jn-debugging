import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrate } from './reclassify.mjs';
import { readPages, parseFrontmatter, createSidebar, buildRedirects } from './lib/content.mjs';

async function fixture(t, files) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'kb-reclassify-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const [file, source] of Object.entries(files)) {
		const dest = path.join(root, 'src/content/docs', file);
		await mkdir(path.dirname(dest), { recursive: true });
		await writeFile(dest, source);
	}
	return root;
}

const article = (extra = '', body = '## 快速結論\n\nKeep the actual fix.\n') =>
	`---\ntitle: Test\ndate: 2026-11-21\nstatus: fixed\n${extra}---\n${body}`;

test('dry-run, flatten, preserve metadata/aliases and rewrite internal links/related, then no-op', async (t) => {
	const source = article('aliases: ["a keyword", "apostrophe\'s alias"]\nrelated:\n  - docker/newsblur-second\nhead:\n  - tag: meta\n    attrs:\n      name: example\n      content: keep\n',
		'## 快速結論\n\n[second](/docker/newsblur-second/#fix)\n[absolute](https://debug.giveanornot.com/docker/newsblur-second/)\n[external](https://other.example/docker/newsblur-second/)\n');
	const root = await fixture(t, { 'docker/newsblur-first.md': source, 'docker/newsblur-second.md': article() });
	assert.equal((await migrate(root)).moved, 2);
	assert.equal(await readFile(path.join(root, 'src/content/docs/docker/newsblur-first.md'), 'utf8'), source);
	await migrate(root, { write: true });
	const after = await readFile(path.join(root, 'src/content/docs/newsblur-first.md'), 'utf8');
	const data = parseFrontmatter(after);
	assert.deepEqual(data.aliases, ['a keyword', "apostrophe's alias", '/docker/newsblur-first/']);
	assert.deepEqual(data.related, ['newsblur-second']);
	assert.deepEqual(data.head, parseFrontmatter(source).head);
	assert.equal(data.date, '2026-11-21');
	assert.equal(data.category, 'newsblur');
	assert.match(after, /\[second\]\(\/newsblur-second\/#fix\)/);
	assert.match(after, /https:\/\/debug\.giveanornot\.com\/newsblur-second\//);
	assert.match(after, /https:\/\/other\.example\/docker\/newsblur-second\//);
	assert.equal((await migrate(root, { write: true })).changed, 0);
	assert.equal(await readFile(path.join(root, 'src/content/docs/newsblur-first.md'), 'utf8'), after);
});

test('reject duplicate flat slugs before modifying any source', async (t) => {
	const source = article();
	const root = await fixture(t, { 'docker/newsblur-duplicate.md': source, 'web/newsblur-duplicate.md': source });
	await assert.rejects(migrate(root, { write: true }), /Duplicate flat slug/);
	assert.equal(await readFile(path.join(root, 'src/content/docs/docker/newsblur-duplicate.md'), 'utf8'), source);
});

test('block-style aliases are replaced once, preserving each original keyword without duplicates', async (t) => {
	const root = await fixture(t, { 'docker/newsblur-block.md': article('aliases:\n  - first keyword\n  - second keyword\nrelated:\n  - newsblur-other\n') });
	await migrate(root, { write: true });
	const file = path.join(root, 'src/content/docs/newsblur-block.md');
	assert.deepEqual(parseFrontmatter(await readFile(file, 'utf8')).aliases,
		['first keyword', 'second keyword', '/docker/newsblur-block/']);
	assert.equal((await migrate(root, { write: true })).changed, 0);
});

test('reject existing destination, alias collisions and invalid categories before writes', async (t) => {
	const root = await fixture(t, { 'docker/newsblur-first.md': article(), 'newsblur-first.md': article() });
	await assert.rejects(migrate(root, { write: true }), /Target already exists|Duplicate flat slug/);
	const page = { slug: 'one', url: '/one/', aliases: ['/old/'] };
	assert.throws(() => buildRedirects([page, { slug: 'two', url: '/two/', aliases: ['/old'] }]), /Alias collision/);
	assert.throws(() => buildRedirects([page, { slug: 'old', url: '/old/', aliases: [] }]), /canonical/);
	assert.throws(() => buildRedirects([{ ...page, aliases: ['//evil.example'] }]), /Invalid path alias/);
});

test('keyword aliases stay searchable; path aliases generate article and image 301 destinations', () => {
	const pairs = buildRedirects([{ slug: 'newsblur-first', url: '/newsblur-first/', aliases: ['search me', '/docker/newsblur-first/'] }]);
	assert.deepEqual(new Map(pairs), new Map([
		['/docker/newsblur-first', '/newsblur-first/'],
		['/docker/newsblur-first/', '/newsblur-first/'],
		['/og/docker/newsblur-first.png', '/og/newsblur-first.png'],
	]));
});

test('changing category changes navigation without changing URL or being overridden by migration defaults', async (t) => {
	const root = await fixture(t, { 'newsblur-first.md': article('category: database\n') });
	assert.equal((await migrate(root, { write: true })).changed, 0);
	const pages = await readPages(root);
	assert.equal(pages[0].url, '/newsblur-first/');
	assert.equal(pages[0].section, 'server');
	const sidebar = createSidebar(pages);
	assert.ok(sidebar.find((group) => group.label === '伺服器與網路').items.some((group) => group.items.includes('newsblur-first')));
	assert.ok(!sidebar.some((group) => group.label === '自架服務'));
});

test('unknown categories and unflattened runbooks fail the index/build validation', async (t) => {
	const root = await fixture(t, { 'newsblur-first.md': article('category: imaginary\n') });
	await assert.rejects(readPages(root), /Unknown category/);
	await assert.rejects(migrate(root, { write: true }), /Unknown category/);
});
