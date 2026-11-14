import { createHash, randomBytes } from 'crypto';
export const randomState = () => randomBytes(24).toString('base64url');
export const makeVerifier = () => randomBytes(48).toString('base64url');
export const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
