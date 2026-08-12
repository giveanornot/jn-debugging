import type { APIRoute } from 'astro';
import { renderOgImage } from '../lib/og-image';

export const prerender = true;

export const GET: APIRoute = async () => {
	const png = await renderOgImage('Troubleshooting runbooks', 'JN debugging');
	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
