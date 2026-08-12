import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = process.cwd();

function run(script, extraEnv = {}) {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand;
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${npmCommand} run ${script}`]
    : ['run', script];
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('validate');
run('build:pages');
run('check:staging');
run('check:performance', { VERIFY_SITE_DIR: path.resolve(rootDir, '.pages') });
run('test:browser', { VERIFY_SITE_DIR: path.resolve(rootDir, '.pages') });
