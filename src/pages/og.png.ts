import type { APIRoute } from 'astro';
import sharp from 'sharp';

export const prerender = true;

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101827" />
      <stop offset="1" stop-color="#1e3a5f" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#background)" />
  <rect x="72" y="72" width="10" height="486" rx="5" fill="#38bdf8" />
  <text x="120" y="250" fill="#f8fafc" font-family="sans-serif" font-size="72" font-weight="700">JN debugging</text>
  <text x="120" y="330" fill="#bae6fd" font-family="sans-serif" font-size="32">Troubleshooting runbooks</text>
  <text x="120" y="390" fill="#bae6fd" font-family="sans-serif" font-size="32">for humans and AI agents</text>
  <text x="120" y="510" fill="#94a3b8" font-family="sans-serif" font-size="24">debug.giveanornot.com</text>
</svg>`;

export const GET: APIRoute = async () => {
	const png = await sharp(Buffer.from(svg)).png().toBuffer();
	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
