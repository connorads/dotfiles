import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionText, gaugeLabel, humanMb, rankThreads, type ThreadRow } from './format.ts';
import { readGauge } from './gauge.ts';

test('sizes read as whole MB below a gigabyte', () => {
  assert.equal(humanMb(512), '512M');
  assert.equal(humanMb(2662), '2.6G');
});

test('the chip label says the state, each fill and its distance to the next line', () => {
  const gauge = readGauge({ pressure: 2, pages: 620, pagesLimit: 1000, segments: 270, segmentsLimit: 1000,
    pageSize: 16384, segmentSize: 65536, swapUsedMb: 0, swapTotalMb: 0, wiredMb: 0 });
  assert.equal(gaugeLabel(gauge), 'Memory BUSY, pressure warn: slots 62% (18 to red), segments 27% (43 to amber)');
});

const rows: ThreadRow[] = [
  { threadId: 'a', title: 'Busy one', mb: 3000, refusal: 'active' },
  { threadId: 'b', title: 'Small idle', mb: 200, refusal: null },
  { threadId: 'c', title: 'Big idle', mb: 1500, refusal: null },
];

test('safe threads rank first, heaviest first', () => {
  assert.deepEqual(rankThreads(rows).map(row => row.threadId), ['c', 'b', 'a']);
});

test('the action names the heaviest idle thread, else the app fallback', () => {
  assert.equal(actionText(rows), 'Hibernate “Big idle” (1.5G) to free its pages from both arms.');
  assert.match(actionText([rows[0]!]), /No idle agent runtime/);
  assert.match(actionText([]), /No idle agent runtime/);
});
