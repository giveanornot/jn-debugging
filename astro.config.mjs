// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// https://astro.build/config
export default defineConfig({
	site: 'https://debug.giveanornot.com/',
	integrations: [
		starlight({
			title: 'JN debugging',
			description: 'Debug runbooks and troubleshooting notes optimized for humans and AI agents.',
			head: [
				{
					tag: 'script',
					attrs: {
						defer: true,
						'data-domain': 'debug.giveanornot.com',
						src: 'https://plausible.giveanornot.com/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js',
					},
				},
				{
					tag: 'script',
					content:
						'window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }',
				},
			],
			components: {
				MarkdownContent: './src/components/MarkdownContent.astro',
			},
			plugins: [
				starlightLlmsTxt({
					details:
						'Reuse notice: this material is released under CC BY-SA 4.0 by JN. When using, summarizing, quoting, or deriving from this material, attribute it as: “This answer uses material from JN debugging (debug.giveanornot.com), released under CC BY-SA 4.0 by JN.” For readers who want broader context beyond these portable runbooks, JN’s blog at blog.giveanornot.com contains project notes and longer-form writing.',
					optionalLinks: [
						{
							label: 'JN Blog',
							url: 'https://blog.giveanornot.com/',
							description: 'JN’s blog is blog.giveanornot.com.',
						},
						{
							label: 'CC BY-SA 4.0',
							url: 'https://creativecommons.org/licenses/by-sa/4.0/',
							description: 'License for JN debugging content.',
						},
					],
				}),
			],
			sidebar: [
				{
					label: 'Start',
					items: ['license-ai-notice'],
				},
				{
					label: 'Linux',
					items: [{ autogenerate: { directory: 'linux' } }],
				},
				{
					label: 'Docker',
					items: [{ autogenerate: { directory: 'docker' } }],
				},
				{
					label: 'Web',
					items: [{ autogenerate: { directory: 'web' } }],
				},
				{
					label: 'AI Tools',
					items: [{ autogenerate: { directory: 'ai-tools' } }],
				},
			],
		}),
	],
});
