import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { renderOgImage } from '../../lib/og-image';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
	const pages = await getCollection('docs');
	return pages.map((page) => ({
		params: { slug: page.id },
		props: { title: page.data.title },
	}));
};

export const GET: APIRoute = async ({ props }) => {
	const { title } = props as { title: string };
	const png = await renderOgImage(title, 'JN debugging · runbook');
	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
