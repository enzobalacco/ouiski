import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { exportStatic } from './mobile-test/export-static.mjs';

test('Export : neuf ressources autonomes, empreintes vérifiées et génération reproductible', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'ouiski-static-'));
  try {
    const first = await exportStatic(destination);
    assert.equal(Object.keys(first.files).length, 9);
    assert.equal(Object.keys(first.files).some(n => /server|private|\.git|package/.test(n)), false);
    for (const [name, hash] of Object.entries(first.files)) {
      assert.equal(createHash('sha256').update(await readFile(join(destination, name))).digest('hex'), hash);
    }
    assert.deepEqual(await exportStatic(destination), first);
    assert.equal((await readFile(join(destination, 'modules/gps-tracker.mjs'), 'utf8')).includes('node:crypto'), false);
  } finally { await rm(destination, { recursive: true, force: true }); }
});

test('Export : fichier inconnu préservé et symlink refusé avant toute écriture', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'ouiski-static-'));
  try {
    await writeFile(join(destination, 'personal.txt'), 'ne pas modifier');
    await assert.rejects(exportStatic(destination), /inattendu/);
    assert.equal(await readFile(join(destination, 'personal.txt'), 'utf8'), 'ne pas modifier');
    await rm(join(destination, 'personal.txt'));
    await symlink(tmpdir(), join(destination, 'modules'));
    await assert.rejects(exportStatic(destination), /symbolique/);
  } finally { await rm(destination, { recursive: true, force: true }); }
});
