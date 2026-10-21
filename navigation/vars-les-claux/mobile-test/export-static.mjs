import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const sources = {
  'index.html': 'index.html', 'app.mjs': 'app.mjs', 'session.mjs': 'session.mjs', 'style.css': 'style.css',
  'network.json': '../network.json', 'source.json': '../../../dist/ski-data.json',
  'modules/gps-tracker.mjs': '../gps-tracker.mjs',
  'modules/gps-geometry.mjs': '../gps-geometry.mjs',
  'modules/network-validation.mjs': '../network-validation.mjs',
};

/** Prépare seulement des fichiers statiques, sans compte, clé, serveur ou déploiement. */
export async function exportStatic(destination) {
  const allowed = new Set([...Object.keys(sources), 'manifest.json', 'modules']);
  async function inspect(path, prefix = '') {
    let stat;
    try { stat = await lstat(path); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Dossier de sortie invalide');
    for (const name of await readdir(path)) {
      const relative = prefix + name;
      if (!allowed.has(relative)) throw new Error(`Fichier inattendu dans la sortie : ${relative}`);
      const child = await lstat(join(path, name));
      if (child.isSymbolicLink()) throw new Error('Lien symbolique interdit dans la sortie');
      if (child.isDirectory()) {
        if (relative !== 'modules') throw new Error('Sous-dossier de sortie invalide');
        await inspect(join(path, name), 'modules/');
      } else if (!child.isFile() || relative === 'modules') throw new Error('Fichier de sortie invalide');
    }
  }
  await inspect(destination);
  const files = await Promise.all(Object.entries(sources).map(async ([name, source]) => [name, await readFile(new URL(source, import.meta.url))]));
  const manifest = { format: 1, purpose: 'private-gps-test-only', files: Object.fromEntries(files.map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) };
  for (const [name, bytes] of files) {
    const target = join(destination, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = fileURLToPath(new URL('private-build', import.meta.url));
  const manifest = await exportStatic(destination);
  console.log(`Export privé préparé : ${Object.keys(manifest.files).length} fichiers, aucun déploiement effectué.`);
}
