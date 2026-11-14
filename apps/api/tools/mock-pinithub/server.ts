import express from 'express';
import { deflateSync } from 'zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
/** A real PNG (gradient) so platforms accept it. */
function png(w: number, h: number, seed: number) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w + seed * 60) % 256; raw[o + 1] = y * 255 / h; raw[o + 2] = 120 + seed * 40; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const port = Number(process.env.BRIDGE_PORT ?? 4100);
const files = [0, 1, 2].map(i => png(800, 500, i));
const names = ['Brand photo (protected)', 'Product shot (protected)', 'Event banner (protected)'];
const events: { assetId: string; targetId: string; platform: string; url: string; publishedAt: string }[] = [];

const app = express(); app.use(express.json());
const owner = (req: express.Request) => String(req.header('x-owner-id') ?? '');
const mk = (i: number, o: string) => ({ id: `asset-${i}`, name: names[i], owner: o, url: `http://localhost:${port}/files/${i}.png`, mime: 'image/png', width: 800, height: 500, bytes: files[i].length });

app.get('/assets', (req, res) => res.json([0, 1, 2].map(i => mk(i, owner(req)))));
// asset-99 belongs to somebody else: used to prove another owner's asset is never exposed
app.get('/assets/:id/protected-copy', (req, res) => {
  if (req.params.id === 'asset-99') return res.json({ ...mk(0, 'someone-else'), id: 'asset-99' });
  const i = Number(String(req.params.id).replace('asset-', ''));
  return files[i] ? res.json(mk(i, owner(req))) : res.status(404).send('not found');
});
app.get('/files/:n.png', (req, res) => { const f = files[Number(req.params.n)]; f ? res.type('png').send(f) : res.status(404).end(); });
app.post('/assets/:id/events', (req, res) => {
  if (!events.some(e => e.targetId === req.body.targetId)) events.push({ assetId: String(req.params.id), ...req.body }); // de-duplicate by targetId
  res.status(202).json({ ok: true });
});
app.get('/assets/:id/events', (req, res) => res.json(events.filter(e => e.assetId === req.params.id)));
app.listen(port, () => console.log('mock PinITHUB bridge on :' + port));
