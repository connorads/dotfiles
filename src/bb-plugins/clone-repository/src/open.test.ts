import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpener, type Project } from './open.ts';

function fixture() {
  const projects: Project[] = [];
  let clones = 0;
  let created = 0;
  let exists = false;
  let failRegistration = true;
  const open = createOpener({
    prepare: async () => {
      if (!exists) { clones++; exists = true; }
      return { ok: true as const, path: '/tmp/synthetic/atlas', reused: true };
    },
    listProjects: async () => projects,
    createProject: async (path, name) => {
      created++;
      await new Promise(resolve => setImmediate(resolve));
      if (failRegistration) throw new Error('Temporarily unavailable');
      const project = { id: 'project-atlas', name, sources: [{ hostId: 'mac', path }] };
      projects.push(project);
      return project;
    },
  }, 'mac');
  return { open, counts: () => ({ clones, created }), recover: () => { failRegistration = false; } };
}

test('registration retry preserves the checkout and reuses the registered project', async () => {
  const f = fixture();
  const first = await f.open('acme/atlas', '/tmp/synthetic/atlas');
  assert.deepEqual(first, { ok: false, stage: 'register', path: '/tmp/synthetic/atlas', message: 'Checkout kept at /tmp/synthetic/atlas. Temporarily unavailable' });
  f.recover();
  assert.deepEqual(await f.open('acme/atlas', '/tmp/synthetic/atlas'), { ok: true, projectId: 'project-atlas', path: '/tmp/synthetic/atlas' });
  await f.open('acme/atlas', '/tmp/synthetic/atlas');
  assert.deepEqual(f.counts(), { clones: 1, created: 2 });
});

test('simultaneous opens do not register duplicate projects', async () => {
  const f = fixture(); f.recover();
  const results = await Promise.all([f.open('acme/atlas', '/tmp/synthetic/atlas'), f.open('acme/atlas', '/tmp/synthetic/atlas'), f.open('acme/atlas', '/tmp/synthetic/atlas')]);
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(f.counts(), { clones: 1, created: 1 });
});

test('clone failure does not register a project', async () => {
  let registrations = 0;
  const open = createOpener({
    prepare: async () => ({ ok: false, message: 'Destination contains another repository.' }),
    listProjects: async () => [],
    createProject: async () => { registrations++; throw new Error('Unexpected registration'); },
  }, 'mac');
  assert.deepEqual(await open('acme/atlas', '/tmp/conflict'), { ok: false, stage: 'clone', message: 'Destination contains another repository.' });
  assert.equal(registrations, 0);
});
