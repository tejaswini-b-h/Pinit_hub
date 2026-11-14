import { createApp } from '../dist/app';
import type { Request, Response } from 'express';

// Build the Express app once (cold start) and reuse across invocations.
const app = createApp();

// Vercel expects a default export that is a request handler.
export default (req: Request, res: Response) => {
  // `app` is a function (req, res) => void
  app(req, res);
};

