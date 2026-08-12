import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

const siteUrl = 'https://debug.giveanornot.com';

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
	if (context.url.pathname === '/404/' || context.url.pathname === '/404') {
		route.head.push({
			tag: 'meta',
			attrs: { name: 'robots', content: 'noindex, nofollow' },
		});
		return;
	}

	const schema = route.id
		? {
				'@context': 'https://schema.org',
				'@type': 'TechArticle',
				headline: data.title,
				description: data.description,
				url,
				inLanguage: route.lang,
				author: {
					'@type': 'Person',
					name: 'JN',
				},
				publisher: {
					'@type': 'Organization',
					name: 'JN debugging',
					url: siteUrl,
				},
				license: 'https://creativecommons.org/licenses/by-sa/4.0/',
				...(data.date ? { datePublished: data.date.toISOString() } : {}),
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
				},
			};

	route.head.push({
		tag: 'script',
		attrs: { type: 'application/ld+json' },
		content: jsonLd(schema),
	});
});
