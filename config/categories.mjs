// Navigation is independent of file paths and URLs. Edit labels/groups here.
export const sections = [
	{ id: 'ai-tools', label: 'AI 工具', groups: [
		['codex', 'Codex'], ['editors', '編輯器整合'], ['agents', '其他 Agent'], ['automation', '瀏覽器與搜尋自動化'],
	] },
	{ id: 'desktop', label: 'Linux 桌面', groups: [
		['session', '桌面、顯示與登入'], ['input', '輸入法'], ['audio', '音訊'],
		['apps', '應用程式'], ['packages', '套件與執行環境'], ['gaming', '遊戲與 Wine'],
	] },
	{ id: 'server', label: '伺服器與網路', groups: [
		['network', '網路與遠端連線'], ['proxy', '反向代理與憑證'], ['containers', '容器'],
		['database', '資料庫'], ['permissions', '系統權限'],
	] },
	{ id: 'services', label: '自架服務', groups: [
		['newsblur', 'NewsBlur'], ['rsshub', 'RSSHub'], ['postiz', 'Postiz'], ['nextcloud', 'Nextcloud'],
		['artalk', 'Artalk'], ['n8n', 'n8n'], ['other-services', '其他自架服務'],
	] },
	{ id: 'web', label: '網站與發布', groups: [
		['indieping', 'IndiePing'], ['pwa', 'PWA 與 Good POSSE'], ['static-sites', '靜態網站與 CMS'],
		['social-api', '社群 API'], ['cloudflare', 'Cloudflare 與部署'], ['html', 'HTML 與電子報'],
	] },
	{ id: 'hardware', label: '硬體與韌體', groups: [
		['keyboards', '鍵盤與控制器'], ['3d-printing', '3D 列印'],
	] },
];

export const categories = new Map(sections.flatMap((section) => section.groups.map(([id, label]) =>
	[id, { id, label, section: section.id, sectionLabel: section.label }]
)));

// Migration defaults only. Once assigned, frontmatter is the source of truth.
const rules = [
	['codex', /^codex-/], ['editors', /^vscodium-/], ['agents', /^(omp-|openclaw-)/],
	['automation', /^(threads-(search|quoted)-|plurk-search-)/],
	['session', /^(cosmic-(nvidia|session|chromium)-|arch-(nvidia|elan)-|gnome-keyring-)/],
	['input', /^(rime-|cosmic-fcitx-|wayland-rofimoji-)/], ['audio', /^pipewire-/],
	['apps', /^(android-quick-share-|brave-|jlcone-|youtube-)/],
	['packages', /^(arch-aur-|arch-paru-|python-venv-)/], ['gaming', /^(stardew-|wine-)/],
	['network', /^(hinet-|remmina-|docker-wireguard-|ddclient-)/], ['proxy', /^cosmos-/],
	['containers', /^docker-compose-/], ['database', /^clickhouse-/], ['permissions', /^(ubuntu-sudo-|arch-web-serial-)/],
	['newsblur', /^newsblur-/], ['rsshub', /^rsshub-/], ['postiz', /^postiz-/],
	['nextcloud', /^nextcloud-/], ['artalk', /^artalk-/], ['n8n', /^n8n-/],
	['other-services', /^(hedgedoc-|plausible-|self-hosted-)/], ['indieping', /^indieping-/],
	['pwa', /^(pwa-|good-posse-|local-first-|r2-|framework7-)/],
	['static-sites', /^(hugo-|astro-|starlight-|sveltia-)/],
	['social-api', /^(instagram-|mastodon-|threads-oauth-)/], ['cloudflare', /^(cloudflare-|wrangler-)/],
	['html', /^(html-pattern-|newsletter-)/], ['keyboards', /^(mk870-|rp2040-)/], ['3d-printing', /^marlin-/],
];

export function classify(slug) {
	const matches = rules.filter(([, pattern]) => pattern.test(slug));
	if (matches.length !== 1) throw new Error(`Expected one category for ${slug}, found ${matches.length}`);
	return matches[0][0];
}
