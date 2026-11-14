
import { createApp } from '../src/app';
import type { Request, Response } from 'express';

const app = createApp();

export default (req: Request, res: Response) => {
  app(req, res);
};
