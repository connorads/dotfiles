// webmux configuration — tailored to local tmux bindings

const customDrawerButtons = [
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
			const relabelledDefaults = defaults.map((button) => {
				if (button.id === 'tmux-files') {
					return {
						...button,
						label: 'Yazi',
						description: 'Open Yazi file manager popup',
					}
				}

				return button
			})

			const buttonsById = new Map()

			for (const button of relabelledDefaults) {
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
