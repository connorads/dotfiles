import { describe, expect, test } from 'bun:test'
import { defaultCommands } from '../src/drawer/commands'

describe('defaultCommands', () => {
	test('has 12 commands', () => {
		expect(defaultCommands).toHaveLength(12)
	})

	test('all commands have label and seq', () => {
		for (const cmd of defaultCommands) {
			expect(cmd.label).toBeTruthy()
			expect(cmd.seq).toBeTruthy()
		}
	})

	test('all seqs start with tmux prefix (Ctrl-b)', () => {
		for (const cmd of defaultCommands) {
			expect(cmd.seq.startsWith('\x02')).toBe(true)
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
})
