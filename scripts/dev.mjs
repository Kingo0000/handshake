// Runs the API and the Vite dev server together; Ctrl+C stops both.
// Children are node processes (not npm wrappers) so stop signals actually reach them.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// PORT is left to hosts like Render; in dev the API always sits on API_PORT behind Vite's proxy.
const apiPort = process.env.API_PORT || '8787';
const env = { ...process.env, API_PORT: apiPort };

const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { cwd: root, stdio: 'inherit', env: { ...env, PORT: apiPort } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit', env }),
];

function stop() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}

for (const child of children) {
  child.on('exit', (code) => {
    if (code) process.exitCode = code;
    stop();
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
