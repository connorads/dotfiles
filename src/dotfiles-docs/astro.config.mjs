// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// https://astro.build/config
export default defineConfig({
	site: 'https://dotfiles.connoradams.co.uk',
	integrations: [
		starlight({
			// Internal links here are extensionless routes (/trust/supply-chain/),
			// which no filesystem resolver can follow - the dotfiles-wide lychee
			// gate skips this directory for that reason. This plugin checks them
			// at build time, where the route table is known, so a renamed or
			// deleted page fails `pnpm build` instead of shipping a dead link.
			plugins: [starlightLinksValidator()],
			title: 'How I work',
			description:
				'My dotfiles, justified - a terminal-first, agent-heavy workflow explained.',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/connorads/dotfiles',
				},
			],
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{ label: 'Why work like this', slug: 'why' },
				{
					label: 'Speed is compound',
					items: [
						{ slug: 'speed/navigate-without-thinking' },
						{ slug: 'speed/two-keystroke-everything' },
						{ slug: 'speed/one-keybinding-to-escape' },
					],
				},
				{
					label: 'Portable by default',
					items: [
						{ slug: 'portable/terminal-over-ide' },
						{ slug: 'portable/tmux-is-the-workspace' },
						{ slug: 'portable/same-shell-everywhere' },
					],
				},
				{
					label: 'Working with agents',
					items: [
						{ slug: 'agents/research-and-discuss' },
						{ slug: 'agents/fork-the-conversation' },
						{ slug: 'agents/which-agent-is-ready' },
						{ slug: 'agents/editors-for-the-agent-age' },
					],
				},
				{
					label: 'Trust but verify',
					items: [{ slug: 'trust/supply-chain' }, { slug: 'trust/sandboxes' }],
				},
			],
		}),
	],
});
