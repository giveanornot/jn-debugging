import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

const siteUrl = 'https://debug.giveanornot.com';
const authorUrl = `${siteUrl}/about/`;
const ogImageUrl = `${siteUrl}/og.png`;

function jsonLd(value: Record<string, unknown>) {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const { data } = route.entry;
	const url = new URL(context.url.pathname, siteUrl).href;
	const tags = data.tags ?? [];
	const ogLocale = route.head.find(
		(entry) => entry.tag === 'meta' && entry.attrs?.property === 'og:locale'
	);
	if (ogLocale?.attrs) ogLocale.attrs.content = route.lang.replace('-', '_');
	const ogType = route.head.find(
		(entry) => entry.tag === 'meta' && entry.attrs?.property === 'og:type'
	);
	if (ogType?.attrs) ogType.attrs.content = route.id ? 'article' : 'website';
	if (context.url.pathname === '/404/' || context.url.pathname === '/404') {
		route.head.push({
			tag: 'meta',
			attrs: { name: 'robots', content: 'noindex, nofollow' },
		});
		return;
	}
	for (const [property, content] of [
		['og:image', ogImageUrl],
		['og:image:width', '1200'],
		['og:image:height', '630'],
		['og:image:type', 'image/png'],
		['twitter:image', ogImageUrl],
	] as const) {
		route.head.push({ tag: 'meta', attrs: { property, content } });
	}

	const schema = route.id === 'about'
		? {
				'@context': 'https://schema.org',
				'@type': 'Person',
				name: 'JN',
				url,
				sameAs: ['https://blog.giveanornot.com/'],
			}
		: route.id
		? {
				'@context': 'https://schema.org',
				'@type': ['Article', 'TechArticle'],
				headline: data.title,
				description: data.description,
				url,
				inLanguage: route.lang,
				image: [ogImageUrl],
				author: {
					'@type': 'Person',
					name: 'JN',
					url: authorUrl,
				},
				publisher: {
					'@type': 'Organization',
					name: 'JN debugging',
					url: siteUrl,
				},
				license: 'https://creativecommons.org/licenses/by-sa/4.0/',
				...(data.date ? { datePublished: data.date.toISOString() } : {}),
				...(route.lastUpdated ? { dateModified: route.lastUpdated.toISOString() } : {}),
				...(tags.length ? { keywords: tags.join(', ') } : {}),
			}
		: {
				'@context': 'https://schema.org',
				'@type': 'WebSite',
				name: 'JN debugging',
				description: data.description,
				url,
				inLanguage: route.lang,
				publisher: {
					'@type': 'Person',
					name: 'JN',
					url: authorUrl,
				},
			};

	route.head.push({
		tag: 'script',
		attrs: { type: 'application/ld+json' },
		content: jsonLd(schema),
	});
});
