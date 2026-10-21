import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/app.mjs', ['app.mjs', 'text/javascript']], ['/session.mjs', ['session.mjs', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/network.json', ['../network.json', 'application/json']],
  ['/source.json', ['../../../dist/ski-data.json', 'application/json']],
  ...['gps-tracker.mjs', 'gps-geometry.mjs', 'network-validation.mjs'].map(n => [`/modules/${n}`, [`../${n}`, 'text/javascript']]),
]);

/** Serveur de fichiers en liste blanche, sans route de collecte ni journal HTTP. */
export function createMobileTestServer({ hostname = '127.0.0.1', tls } = {}) {
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      const host = new URL(`http://${req.headers.host}`).hostname;
      if (![hostname, '127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403); res.end(); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      if (url.search) { res.writeHead(400); res.end(); return; }
      const file = files.get(decodeURIComponent(url.pathname));
      if (!file) { res.writeHead(404); res.end(); return; }
      const bytes = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(400); res.end(); }
  };
  return tls ? https.createServer(tls, handler) : http.createServer(handler);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--host', '--port', '--cert', '--key'].includes(args[i]) || !args[i+1]) throw new Error('Arguments invalides');
    values[args[i]] = args[i+1];
  }
  const hostname = values['--host'] || '127.0.0.1', port = Number(values['--port'] || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port invalide');
  const hasTls = values['--cert'] && values['--key'];
  if (!!values['--cert'] !== !!values['--key']) throw new Error('Certificat et clé nécessaires ensemble');
  if (!['127.0.0.1', 'localhost'].includes(hostname) && !hasTls) throw new Error('HTTPS requis pour une écoute réseau');
  const tls = hasTls ? { cert: await readFile(values['--cert']), key: await readFile(values['--key']) } : undefined;
  const server = createMobileTestServer({ hostname, tls });
  server.listen(port, hostname, () => console.log(`Banc d’essai prêt : ${tls ? 'HTTPS' : 'local HTTP'}, port ${port}. Aucun suivi actif.`));
}
