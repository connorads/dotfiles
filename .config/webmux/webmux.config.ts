// webmux configuration — tailored to local tmux bindings

const customDrawerButtons = [
	{
		id: 'tmux-split-vertical',
		label: 'Split |',
		description: 'Split pane vertically in cwd',
		action: { type: 'send', data: '\x02|' },
	},
	{
		id: 'tmux-split-horizontal',
		label: 'Split —',
		description: 'Split pane horizontally in cwd',
		action: { type: 'send', data: '\x02-' },
	},
	{
		id: 'tmux-sessions',
		label: 'Sessions',
		description: 'Open tmux session picker',
		action: { type: 'send', data: '\x02S' },
	},
	{
		id: 'tmux-windows',
		label: 'Windows',
		description: 'Open tmux window picker',
		action: { type: 'send', data: '\x02W' },
	},
	{
		id: 'tmux-git',
		label: 'Git',
		description: 'Open Lazygit popup',
		action: { type: 'send', data: '\x02g' },
	},
	{
		id: 'tmux-files',
		label: 'Yazi',
		description: 'Open Yazi file manager popup',
		action: { type: 'send', data: '\x02y' },
	},
	{
		id: 'tmux-links',
		label: 'Links',
		description: 'Open tmux links picker',
		action: { type: 'send', data: '\x02u' },
	},
	{
		id: 'scratch-shell',
		label: 'Scratch',
		description: 'Open scratch shell popup',
		action: { type: 'send', data: '\x02`' },
	},
	{
		id: 'neovim',
		label: 'Neovim',
		description: 'Open Neovim popup',
		action: { type: 'send', data: '\x02v' },
	},
	{
		id: 'detach',
		label: 'Detach',
		description: 'Detach tmux client',
		action: { type: 'send', data: '\x02d' },
	},
	{
		id: 'thumbs',
		label: 'Thumbs',
		description: 'Open tmux-thumbs picker',
		action: { type: 'send', data: '\x02 ' },
	},
	{
		id: 'ai-usage',
		label: 'AI Usage',
		description: 'Open AI usage popup',
		action: { type: 'send', data: '\x02a' },
	},
	{
		id: 'critique',
		label: 'Critique',
		description: 'Open critique diff popup',
		action: { type: 'send', data: '\x02C' },
	},
	{
		id: 'diff',
		label: 'Diff',
		description: 'Open difftastic diff popup',
		action: { type: 'send', data: '\x02D' },
	},
	{
		id: 'gh-dash',
		label: 'gh-dash',
		description: 'Open gh-dash popup',
		action: { type: 'send', data: '\x02G' },
	},
	{
		id: 'ports',
		label: 'Ports',
		description: 'Open port inspector popup',
		action: { type: 'send', data: '\x02P' },
	},
	{
		id: 'layouts',
		label: 'Layouts',
		description: 'Open layout presets picker',
		action: { type: 'send', data: '\x02L' },
	},
	{
		id: 'tailscale',
		label: 'Tailscale',
		description: 'Open Tailscale Serve popup',
		action: { type: 'send', data: '\x02T' },
	},
] as const

const preferredDrawerOrder = [
	'ai-usage',
	'critique',
	'tmux-git',
	'tmux-files',
	'tmux-links',
	'scratch-shell',
	'neovim',
	'detach',
	'thumbs',
	'diff',
	'gh-dash',
	'ports',
	'layouts',
	'tailscale',
	'tmux-new-window',
	'tmux-split-vertical',
	'tmux-split-horizontal',
	'tmux-zoom',
	'tmux-sessions',
	'tmux-windows',
	'tmux-copy',
	'tmux-help',
	'tmux-kill-pane',
	'combo-picker',
] as const

export default {
	mobile: {
		initData: '\x02z',
	},
	floatingButtons: [
		{
			position: 'top-left',
			buttons: [
				{
					id: 'zoom',
					label: 'Zoom',
					description: 'Toggle pane zoom',
					action: { type: 'send', data: '\x02z' },
				},
			],
		},
	],
	drawer: {
		buttons: (defaults) => {
			const buttonsById = new Map()

			for (const button of defaults) {
				buttonsById.set(button.id, button)
			}

			for (const button of customDrawerButtons) {
				buttonsById.set(button.id, button)
			}

			const orderedButtons = []

			for (const id of preferredDrawerOrder) {
				const button = buttonsById.get(id)
				if (button !== undefined) {
					orderedButtons.push(button)
					buttonsById.delete(id)
				}
			}

			for (const button of buttonsById.values()) {
				orderedButtons.push(button)
			}

			return orderedButtons
		},
	},
}
