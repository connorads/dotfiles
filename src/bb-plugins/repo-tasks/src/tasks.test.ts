import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTasks, agendaGroup, relativeMarkdownPath } from './tasks.ts';

test('reads live lists and checkboxes without collecting prose, code or completed work', () => {
  const result = parseTasks(
    '# TODO\n- **Done** - delete the line\nLast reviewed: 2026-09-27\n## Next\n- 2026-10-13 - Acme: send proposal - [journal](engagements/acme/journal.md)\n- [x] Completed\n```md\n- [ ] Example\n```\n- [ ] Call Ben\n  - nested detail\n',
    'TODO.md',
  );
  assert.equal(result.reviewed, '2026-09-27');
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0]?.title, 'send proposal');
  assert.equal(result.tasks[0]?.area, 'Acme');
  assert.equal(result.tasks[0]?.line, 5);
  assert.equal(result.tasks[1]?.title, 'Call Ben');
});
test('does not invent deadlines for availability, events or week dates', () => {
  const { tasks } = parseTasks(
    '## Next\n- After 2026-10-01 - Acme: share material\n- After launch - Acme: teach editing\n- w/c 2026-09-28 - Acme: consider role\n- Before 2027-02-28 - Contribute pension\n',
    'TODO.md',
  );
  assert.deepEqual(
    tasks.map((t) => agendaGroup(t, '2026-10-12')),
    ['Available', 'After an event', 'Dates to clarify', 'Later'],
  );
  assert.equal(tasks[1]?.state, 'waiting');
});
test('derives dates from date headings without using stale this-week headings', () => {
  const { tasks } = parseTasks(
    '## Before 2027-02-28\n- Pay pension\n## This week (to 2026-10-04)\n- Discuss plans\n',
    'TODO.md',
  );
  assert.equal(tasks[0]?.date.kind, 'before');
  assert.equal(tasks[1]?.date.kind, 'none');
});
test('waiting and triage come from headings and source blocking text', () => {
  const { tasks } = parseTasks(
    '## Waiting on others\n- By 2026-10-13 - Acme: update\n## To triage\n- Confirm status\n## Next\n- Acme: move skills (blocked on account)\n',
    'TODO.md',
  );
  assert.deepEqual(
    tasks.map((t) => t.state),
    ['waiting', 'triage', 'waiting'],
  );
  const first = tasks[0];
  assert.ok(first);
  assert.equal(agendaGroup(first, '2026-10-12'), 'Next 7 days');
});
test('handles fence lengths, ordered checkboxes, completed headings and continuation text', () => {
  const { tasks } = parseTasks(
    '~~~md\n- [ ] example\n~~~\n1. [ ] Plain checkbox\n## Done\n- Old work\n## Next\n- [ ] A task\n  with detail\n',
    'TODO.md',
  );
  assert.deepEqual(
    tasks.map((t) => t.title),
    ['Plain checkbox', 'A task'],
  );
  assert.match(tasks[1]?.raw ?? '', /with detail/);
});
test('validates calendar dates and ignores historical dates inside task descriptions', () => {
  const { tasks } = parseTasks(
    '## Next\n- 2026-02-30 - Bad date\n- Acme: follow up on 2026-09-01 call\n',
    'TODO.md',
  );
  assert.deepEqual(
    tasks.map((t) => t.date.kind),
    ['none', 'none'],
  );
});
test('source links stay inside the project and exclude hidden paths', () => {
  assert.equal(
    relativeMarkdownPath(
      'tasks/TODO.md',
      '../engagements/acme/journal.md#call',
    ),
    'engagements/acme/journal.md',
  );
  for (const path of [
    '../../secret.md',
    '/etc/a.md',
    '.ssh/key.md',
    'https://example.com/a.md',
    '%2e%2e/%2e%2e/a.md',
    'a.pdf',
  ]) {
    assert.equal(relativeMarkdownPath('TODO.md', path), null, path);
  }
});
test('task ids follow task content, so edits above a task keep its id', () => {
  const before = parseTasks(
    '## Next\n- Call Ben\n- Call Ben\n## Later\n- Call Ben\n',
    'TODO.md',
  ).tasks;
  const after = parseTasks(
    '# Plan\n\n## Next\n- New task\n- Call Ben\n  with detail\n- Call Ben\n## Later\n- Call Ben\n',
    'TODO.md',
  ).tasks.slice(1);
  assert.equal(new Set(before.map((t) => t.id)).size, 3);
  assert.deepEqual(
    after.map((t) => t.id),
    before.map((t) => t.id),
  );
  assert.deepEqual(
    after.map((t) => t.line),
    [5, 7, 9],
  );
});
