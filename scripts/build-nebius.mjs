import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, ['scripts/build-svelte-frontend.mjs'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PROJECTS_NEBIUS_EDITION: 'true' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
