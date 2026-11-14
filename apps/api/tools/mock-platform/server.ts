import express from 'express';

type Mode = 'ok' | 'timeout' | '429' | '401' | '400' | '403' | '500' | 'timeout_after_send' | 'already_posted' | 'expired_once';
let mode: Mode = 'ok';
let latencyMs = 0;
type P = { key: string; externalId: string; url: string; text: string };
const posts: P[] = [];

const app = express();
app.use(express.json());

app.post('/mode', (req, res) => { mode = req.body.mode; res.json({ mode }); });
app.post('/latency', (req, res) => { latencyMs = Number(req.body.ms) || 0; res.json({ latencyMs }); });
app.post('/reset', (_req, res) => { posts.length = 0; mode = 'ok'; latencyMs = 0; res.json({ ok: true }); });
app.get('/count', (_req, res) => res.json({ count: posts.length }));

function create(key: string, text: string): P {
  const externalId = `mock_${posts.length + 1}`;
  const p = { key, externalId, url: `http://localhost:4200/p/${externalId}`, text };
  posts.push(p);
  return p;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Like a real platform, a plain POST always creates a NEW post. Duplicates are therefore visible in /count.
app.post('/posts', async (req, res) => {
  const { key, text } = req.body;
  if (mode === 'timeout') return; // never answers
  if (mode === 'timeout_after_send') { create(key, text); return; } // saved, but client never hears back
  if (mode === 'expired_once') { mode = 'ok'; return res.status(401).send('token expired'); } // 401 once; /refresh works
  if (mode === '429') return res.status(429).set('retry-after', '2').send('too many requests');
  if (mode === '401') return res.status(401).send('token expired');
  if (mode === '403') return res.status(403).send('daily cap reached');
  if (mode === '400') return res.status(400).send('Text rejected by platform');
  if (mode === '500') return res.status(500).send('server error');
  if (mode === 'already_posted') {
    const existing = posts.find(p => p.key === key);
    if (existing) return res.status(409).json(existing);
  }
  if (latencyMs) await sleep(Math.random() * latencyMs); // widens the window where a kill lands mid-publish
  const p = create(key, text);
  return res.status(201).json({ externalId: p.externalId, url: p.url });
});

app.get('/posts/by-key/:key', (req, res) => {
  const p = posts.find(x => x.key === req.params.key);
  return p ? res.json({ externalId: p.externalId, url: p.url }) : res.status(404).send('not found');
});

app.post('/refresh', (_req, res) =>
  mode === '401' ? res.status(401).send('refresh token revoked') : res.json({ accessToken: 'mock-token-2', expiresIn: 3600 }));

app.listen(Number(process.env.MOCK_PORT ?? 4200), () => console.log('mock platform up'));
