import sharp from 'sharp';

function escapeXml(value: string) {
	return value.replace(/[&<>"']/g, (character) => {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!;
	});
}

function wrapTitle(title: string, lineLength = 20) {
	const characters = Array.from(title);
	const lines: string[] = [];
	for (let index = 0; index < characters.length && lines.length < 5; ) {
		let end = Math.min(index + lineLength, characters.length);
		if (
			end < characters.length &&
			/[A-Za-z0-9_-]/.test(characters[end - 1]) &&
			/[A-Za-z0-9_-]/.test(characters[end])
		) {
			const lastSpace = characters.slice(index, end).lastIndexOf(' ');
			if (lastSpace > 0) end = index + lastSpace + 1;
		}
		lines.push(characters.slice(index, end).join('').trim());
		index = end;
		while (characters[index] === ' ') index += 1;
	}
	return lines;
}

export async function renderOgImage(title: string, label = 'JN debugging') {
	const titleLines = wrapTitle(title)
		.map(
			(line, index) =>
				`<text x="120" y="${250 + index * 62}" fill="#f8fafc" font-family="sans-serif" font-size="50" font-weight="700">${escapeXml(line)}</text>`
		)
		.join('');
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
  <text x="120" y="150" fill="#bae6fd" font-family="sans-serif" font-size="30" font-weight="600">${escapeXml(label)}</text>
  ${titleLines}
  <text x="120" y="540" fill="#94a3b8" font-family="sans-serif" font-size="24">debug.giveanornot.com</text>
</svg>`;

	return sharp(Buffer.from(svg)).png().toBuffer();
}
