import { defineConfig } from 'webmux'

export default defineConfig({
	mobile: {
		initData: '\x02z', // auto-zoom current pane on mobile load
	},
	floatingButtons: [
		{
			id: 'zoom',
			label: 'Zoom',
			description: 'Toggle pane zoom',
			action: { type: 'send', data: '\x02z' },
		},
	],
})
