import { describe, expect, test } from 'bun:test'
import { defaultConfig, defineConfig, serialiseThemeForTtyd } from '../src/config'

describe('defineConfig', () => {
	test('returns default config when called with no args', () => {
		const config = defineConfig()
		expect(config).toEqual(defaultConfig)
	})

	test('overrides font family', () => {
		const config = defineConfig({
			font: { family: 'Monaco, monospace' },
		})
		expect(config.font.family).toBe('Monaco, monospace')
		// Other font defaults preserved
		expect(config.font.mobileSizeDefault).toBe(16)
		expect(config.font.sizeRange).toEqual([8, 32])
	})

	test('overrides nested gesture config', () => {
		const config = defineConfig({
			gestures: { swipe: { threshold: 120 } },
		})
		expect(config.gestures.swipe.threshold).toBe(120)
		// Other swipe defaults preserved
		expect(config.gestures.swipe.enabled).toBe(true)
		expect(config.gestures.swipe.maxDuration).toBe(400)
		// Pinch defaults preserved
		expect(config.gestures.pinch.enabled).toBe(true)
	})

	test('replaces arrays entirely (toolbar row1)', () => {
		const customRow = [{ label: 'A', action: { type: 'send' as const, data: 'a' } }]
		const config = defineConfig({
			toolbar: { row1: customRow },
		})
		expect(config.toolbar.row1).toEqual(customRow)
		// row2 should still have defaults
		expect(config.toolbar.row2.length).toBeGreaterThan(0)
	})

	test('replaces drawer commands array', () => {
		const customCmds = [{ label: 'Test', seq: '\x02t' }]
		const config = defineConfig({
			drawer: { commands: customCmds },
		})
		expect(config.drawer.commands).toEqual(customCmds)
	})
})

describe('defaultConfig', () => {
	test('has catppuccin-mocha theme', () => {
		expect(defaultConfig.theme.background).toBe('#1e1e2e')
		expect(defaultConfig.theme.foreground).toBe('#cdd6f4')
	})

	test('has 9 row1 buttons', () => {
		expect(defaultConfig.toolbar.row1).toHaveLength(9)
	})

	test('has 5 row2 buttons', () => {
		expect(defaultConfig.toolbar.row2).toHaveLength(5)
	})

	test('has 12 drawer commands', () => {
		expect(defaultConfig.drawer.commands).toHaveLength(12)
	})

	test('font size range is [8, 32]', () => {
		expect(defaultConfig.font.sizeRange).toEqual([8, 32])
	})
})

describe('serialiseThemeForTtyd', () => {
	test('produces valid JSON', () => {
		const json = serialiseThemeForTtyd(defaultConfig)
		const parsed = JSON.parse(json)
		expect(parsed.background).toBe('#1e1e2e')
		expect(parsed.foreground).toBe('#cdd6f4')
	})
})
