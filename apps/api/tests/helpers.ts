import { spawn, ChildProcess } from 'child_process';
import path from 'path';

export const API_DIR = path.resolve(__dirname, '..');
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const procs = new Set<ChildProcess>();

export function start(script: string, env: Record<string, string> = {}): ChildProcess {
  const p = spawn(process.execPath, ['--import', 'tsx', script], { cwd: API_DIR, stdio: 'ignore', env: { ...process.env, ...env } });
  procs.add(p); p.on('exit', () => procs.delete(p));
  return p;
}
export const killAll = () => procs.forEach(p => p.kill('SIGKILL'));

/** These tests delete and claim rows, so they refuse to run against a remote database. */
export function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url) && process.env.ALLOW_TEST_ON_REMOTE !== '1')
    throw new Error('Refusing to run destructive tests on a non-local DATABASE_URL. Use a local Postgres (see README) or set ALLOW_TEST_ON_REMOTE=1 on a throwaway project.');
}

export const post = (base: string, p: string, body: unknown) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
