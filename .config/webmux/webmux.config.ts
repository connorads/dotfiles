// webmux configuration — see https://github.com/connorads/webmux
// Uses partial override syntax (no import needed — validated at build time)
export default {
	mobile: {
		initData: '\x02z', // auto-zoom current pane on mobile load
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
}
