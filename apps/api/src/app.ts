import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { requireAuth } from './auth';
import { router, callbackRouter } from './routes';
import { ValidationError } from './services/validate';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: process.env.APP_URL }));
  app.use(express.json({ limit: '200kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 300), standardHeaders: true, legacyHeaders: false }));
  app.get('/health', (_q, r) => { r.json({ ok: true }); });
  app.use('/v1/publish', callbackRouter);
  app.use('/v1/publish', requireAuth, router);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', issues: err.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
    if (err instanceof ValidationError) return res.status(422).json({ problems: err.problems });
    const msg = (err as Error).message || 'Something went wrong';
    console.error(JSON.stringify({ msg: 'request failed', error: msg })); // message only: never tokens or bodies
    res.status(500).json({ error: msg });
  });
  return app;
}
