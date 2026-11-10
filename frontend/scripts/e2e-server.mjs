/**
 * Builds LifeSync with e2e endpoints (intercepted by the tests) into www-e2e/ and
 * serves it as a single-page app on http://localhost:4300.
 */
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = join(root, 'www-e2e', 'browser');
const env = {
  ...process.env,
  LIFESYNC_SUPABASE_URL: 'https://e2e.supabase.test',
  LIFESYNC_SUPABASE_ANON_KEY: 'e2e-public-anon-key-not-a-secret',
  LIFESYNC_API_URL: 'https://api.e2e.test/api',
  LIFESYNC_APP_URL: 'http://localhost:4300',
};

if (!process.env.SKIP_E2E_BUILD) {
  execSync('node scripts/set-env.mjs && node scripts/gen-icons.mjs', { cwd: root, env, stdio: 'inherit' });
  execSync(`npx ng build --output-path=www-e2e`, { cwd: root, env, stdio: 'inherit' });
  // Restore the developer's normal runtime config.
  execSync('node scripts/set-env.mjs', { cwd: root, stdio: 'inherit' });
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(out, urlPath));
  if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(4300, () => console.log('e2e server on http://localhost:4300'));
