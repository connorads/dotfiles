import { describe, expect, test } from 'bun:test'
import { defaultRow1, defaultRow2 } from '../src/toolbar/buttons'

describe('defaultRow1', () => {
	test('starts with Esc', () => {
		expect(defaultRow1[0]?.label).toBe('Esc')
		expect(defaultRow1[0]?.action).toEqual({ type: 'send', data: '\x1b' })
	})

	test('has Ctrl modifier button', () => {
		const ctrl = defaultRow1.find((b) => b.action.type === 'ctrl-modifier')
		expect(ctrl).toBeDefined()
		expect(ctrl?.label).toBe('Ctrl')
	})

	test('has arrow keys', () => {
		const arrows = defaultRow1.filter(
			(b) => b.action.type === 'send' && b.action.data.startsWith('\x1b['),
		)
		expect(arrows).toHaveLength(4)
	})

	test('ends with Enter', () => {
		const last = defaultRow1[defaultRow1.length - 1]
		expect(last?.action).toEqual({ type: 'send', data: '\r' })
	})
})

describe('defaultRow2', () => {
	test('has paste button', () => {
		const paste = defaultRow2.find((b) => b.action.type === 'paste')
		expect(paste).toBeDefined()
		expect(paste?.label).toBe('Paste')
	})

	test('has drawer-open for tmux', () => {
		const tmux = defaultRow2.find(
			(b) => b.action.type === 'drawer-open' && b.action.contextId === 'tmux',
		)
		expect(tmux).toBeDefined()
		expect(tmux?.label).toContain('tmux')
	})

	test('has drawer-open for claude', () => {
		const claude = defaultRow2.find(
			(b) => b.action.type === 'drawer-open' && b.action.contextId === 'claude',
		)
		expect(claude).toBeDefined()
		expect(claude?.label).toContain('claude')
	})

	test('has tmux prev/next as send actions', () => {
		const prev = defaultRow2.find((b) => b.label.includes('Prev'))
		const next = defaultRow2.find((b) => b.label.includes('Next'))
		expect(prev?.action).toEqual({ type: 'send', data: '\x02p' })
		expect(next?.action).toEqual({ type: 'send', data: '\x02n' })
	})
})
