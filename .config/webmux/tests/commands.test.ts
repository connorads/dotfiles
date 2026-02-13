import { describe, expect, test } from 'bun:test'
import {
	defaultClaudeCommands,
	defaultClaudeContext,
	defaultCommands,
	defaultTmuxCommands,
	defaultTmuxContext,
} from '../src/drawer/commands'

describe('defaultCommands (tmux)', () => {
	test('has 14 commands', () => {
		expect(defaultCommands).toHaveLength(14)
	})

	test('all commands have label and seq', () => {
		for (const cmd of defaultCommands) {
			expect(cmd.label).toBeTruthy()
			expect(cmd.seq).toBeTruthy()
		}
	})

	test('all seqs except PgDn start with tmux prefix (Ctrl-b)', () => {
		for (const cmd of defaultCommands) {
			if (cmd.label === 'PgDn') {
				// PgDn sends raw escape — works inside copy mode without prefix
				expect(cmd.seq.startsWith('\x02')).toBe(false)
			} else {
				expect(cmd.seq.startsWith('\x02')).toBe(true)
			}
		}
	})

	test('includes window management commands', () => {
		const labels = defaultCommands.map((c) => c.label)
		expect(labels).toContain('+ Win')
		expect(labels).toContain('Split |')
		expect(labels).toContain('Zoom')
		expect(labels).toContain('Kill')
	})

	test('includes navigation commands', () => {
		const labels = defaultCommands.map((c) => c.label)
		expect(labels).toContain('Sessions')
		expect(labels).toContain('Windows')
	})

	test('includes scroll commands', () => {
		const labels = defaultCommands.map((c) => c.label)
		expect(labels).toContain('PgUp')
		expect(labels).toContain('PgDn')
	})
})

describe('defaultTmuxContext', () => {
	test('has id tmux', () => {
		expect(defaultTmuxContext.id).toBe('tmux')
	})

	test('commands match defaultTmuxCommands', () => {
		expect(defaultTmuxContext.commands).toBe(defaultTmuxCommands)
	})
})

describe('defaultClaudeContext', () => {
	test('has id claude', () => {
		expect(defaultClaudeContext.id).toBe('claude')
	})

	test('has 6 commands', () => {
		expect(defaultClaudeCommands).toHaveLength(6)
	})

	test('commands match defaultClaudeCommands', () => {
		expect(defaultClaudeContext.commands).toBe(defaultClaudeCommands)
	})

	test('includes Mode command with Shift+Tab', () => {
		const mode = defaultClaudeCommands.find((c) => c.label === 'Mode')
		expect(mode?.seq).toBe('\x1b[Z')
	})

	test('includes Yes/No commands', () => {
		const labels = defaultClaudeCommands.map((c) => c.label)
		expect(labels).toContain('Yes')
		expect(labels).toContain('No')
	})

	test('includes slash commands', () => {
		const labels = defaultClaudeCommands.map((c) => c.label)
		expect(labels).toContain('/compact')
		expect(labels).toContain('/clear')
		expect(labels).toContain('/help')
	})

	test('has titlePatterns for auto-detection', () => {
		expect(defaultClaudeContext.titlePatterns).toContain('claude')
	})
})
