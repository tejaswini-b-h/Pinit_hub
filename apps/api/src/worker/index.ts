import 'dotenv/config';
import { claimNext, processTarget } from './engine';
import { watchTokens } from './tokens';
import { deliverEvents } from './bridge';

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const stuckSeconds = Number(process.env.STUCK_SECONDS ?? 600);
const idleMs = Number(process.env.IDLE_MS ?? 1000);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(JSON.stringify({ msg: 'worker started', workerId }));
  let lastWatch = 0, lastDeliver = 0;
  for (;;) {
    try {
      if (Date.now() - lastWatch > 60_000) { lastWatch = Date.now(); await watchTokens(); }
      if (Date.now() - lastDeliver > 10_000) { lastDeliver = Date.now(); await deliverEvents(); }
      const c = await claimNext(workerId, stuckSeconds);
      if (!c) { await sleep(idleMs); continue; }
      await processTarget(c, workerId);
    } catch (e) {
      console.error(JSON.stringify({ msg: 'worker loop error', error: String(e) }));
      await sleep(idleMs);
    }
  }
}
main();
