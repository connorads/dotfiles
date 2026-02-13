import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { defaultConfig } from '../src/config'
import { createFontControls } from '../src/controls/font-size'
import { createHelpOverlay } from '../src/controls/help'
import { createDrawer } from '../src/drawer/drawer'
import { createToolbar } from '../src/toolbar/toolbar'
import type { XTerminal } from '../src/types'

function mockTerminal(): XTerminal {
	return {
		options: { fontSize: 14 },
		input(_data: string, _wasUserInput: boolean) {},
		focus() {},
		onData(_handler: (data: string) => void) {
			return { dispose() {} }
		},
	}
}

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('toolbar integration', () => {
	test('creates toolbar with two rows', () => {
		const term = mockTerminal()
		const drawer = createDrawer(term, defaultConfig.drawer.contexts)
		const { element: toolbar } = createToolbar(term, defaultConfig, drawer.open, drawer.openTo)

		document.body.appendChild(toolbar)

		expect(toolbar.id).toBe('wt-toolbar')
		const rows = toolbar.querySelectorAll('.wt-row')
		expect(rows).toHaveLength(2)
	})

	test('row1 has correct number of buttons', () => {
		const term = mockTerminal()
		const drawer = createDrawer(term, defaultConfig.drawer.contexts)
		const { element: toolbar } = createToolbar(term, defaultConfig, drawer.open, drawer.openTo)

		document.body.appendChild(toolbar)

		const row1 = toolbar.querySelector('.wt-row')
		const buttons = row1?.querySelectorAll('button')
		expect(buttons?.length).toBe(defaultConfig.toolbar.row1.length)
	})

	test('row2 has correct number of buttons', () => {
		const term = mockTerminal()
		const drawer = createDrawer(term, defaultConfig.drawer.contexts)
		const { element: toolbar } = createToolbar(term, defaultConfig, drawer.open, drawer.openTo)

		document.body.appendChild(toolbar)

		const rows = toolbar.querySelectorAll('.wt-row')
		const row2 = rows[1]
		const buttons = row2?.querySelectorAll('button')
		expect(buttons?.length).toBe(defaultConfig.toolbar.row2.length)
	})
})

describe('drawer integration', () => {
	test('creates drawer with tab bar', () => {
		const term = mockTerminal()
		const { drawer } = createDrawer(term, defaultConfig.drawer.contexts)

		document.body.appendChild(drawer)

		const tabs = drawer.querySelector('#wt-drawer-tabs')
		const tabButtons = tabs?.querySelectorAll('button')
		expect(tabButtons?.length).toBe(2)
	})

	test('first context commands rendered by default', () => {
		const term = mockTerminal()
		const { drawer } = createDrawer(term, defaultConfig.drawer.contexts)

		document.body.appendChild(drawer)

		const grid = drawer.querySelector('#wt-drawer-grid')
		const buttons = grid?.querySelectorAll('button')
		const firstContext = defaultConfig.drawer.contexts[0]
		expect(buttons?.length).toBe(firstContext?.commands.length)
	})

	test('open/close toggles state', () => {
		const term = mockTerminal()
		const result = createDrawer(term, defaultConfig.drawer.contexts)

		document.body.appendChild(result.backdrop)
		document.body.appendChild(result.drawer)

		expect(result.isOpen()).toBe(false)

		result.open()
		expect(result.isOpen()).toBe(true)
		expect(result.drawer.classList.contains('open')).toBe(true)

		result.close()
		expect(result.isOpen()).toBe(false)
		expect(result.drawer.classList.contains('open')).toBe(false)
	})

	test('setContext switches active tab and re-renders grid', () => {
		const term = mockTerminal()
		const result = createDrawer(term, defaultConfig.drawer.contexts)

		document.body.appendChild(result.drawer)

		// Switch to claude context
		result.setContext('claude')

		const grid = result.drawer.querySelector('#wt-drawer-grid')
		const buttons = grid?.querySelectorAll('button')
		const claude = defaultConfig.drawer.contexts.find((c) => c.id === 'claude')
		expect(buttons?.length).toBe(claude?.commands.length)

		// Check active tab
		const tabs = result.drawer.querySelector('#wt-drawer-tabs')
		const activeTab = tabs?.querySelector('button.active')
		expect(activeTab?.textContent).toBe('claude')
	})

	test('openTo opens drawer and switches context', () => {
		const term = mockTerminal()
		const result = createDrawer(term, defaultConfig.drawer.contexts)

		document.body.appendChild(result.backdrop)
		document.body.appendChild(result.drawer)

		expect(result.isOpen()).toBe(false)

		result.openTo('claude')

		expect(result.isOpen()).toBe(true)

		const grid = result.drawer.querySelector('#wt-drawer-grid')
		const buttons = grid?.querySelectorAll('button')
		const claude = defaultConfig.drawer.contexts.find((c) => c.id === 'claude')
		expect(buttons?.length).toBe(claude?.commands.length)
	})

	test('hides tab bar when only 1 context', () => {
		const term = mockTerminal()
		const first = defaultConfig.drawer.contexts[0]
		if (!first) throw new Error('expected at least one context')
		const singleContext = [first]
		const { drawer } = createDrawer(term, singleContext)

		document.body.appendChild(drawer)

		const tabs = drawer.querySelector('#wt-drawer-tabs') as HTMLElement
		expect(tabs.style.display).toBe('none')
	})
})

describe('font controls integration', () => {
	test('creates three buttons (-, +, ?)', () => {
		const term = mockTerminal()
		const { element } = createFontControls(term, defaultConfig.font)

		document.body.appendChild(element)

		const buttons = element.querySelectorAll('button')
		expect(buttons).toHaveLength(3)
	})

	test('returns help button reference', () => {
		const term = mockTerminal()
		const { helpButton } = createFontControls(term, defaultConfig.font)
		expect(helpButton.textContent).toBe('?')
	})
})

describe('help overlay integration', () => {
	test('creates help overlay', () => {
		const term = mockTerminal()
		const { helpButton } = createFontControls(term, defaultConfig.font)
		const { element } = createHelpOverlay(term, helpButton)

		document.body.appendChild(element)

		expect(element.id).toBe('wt-help')
		expect(element.innerHTML).toContain('Toolbar')
		expect(element.innerHTML).toContain('Gestures')
	})
})

describe('build output', () => {
	test('injectOverlay produces valid HTML with overlay', async () => {
		const { injectOverlay } = await import('../build')
		const baseHtml = '<html><head></head><body></body></html>'
		const js = 'console.log("test")'
		const css = 'body { color: red; }'

		const result = injectOverlay(baseHtml, js, css, defaultConfig)

		expect(result).toContain('<style>')
		expect(result).toContain('<script type="module">')
		expect(result).toContain('viewport')
		expect(result).toContain('jetbrainsmono-nfm.css')
		expect(result).toContain('</head>')
	})
})
