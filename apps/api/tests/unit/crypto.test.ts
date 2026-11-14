import { randomBytes } from 'crypto';
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
import { encrypt, decrypt } from '../../src/services/crypto';

test('round trip', () => expect(decrypt(encrypt('secret-token'))).toBe('secret-token'));
test('ciphertext does not contain the plaintext', () => expect(encrypt('secret-token')).not.toContain('secret-token'));
test('same input gives different ciphertext (random IV)', () => expect(encrypt('a')).not.toBe(encrypt('a')));
test('tampering is detected', () => {
  const [iv, tag, enc] = encrypt('abc').split('.');
  const bad = [iv, tag, Buffer.from('xxxx').toString('base64')].join('.');
  expect(() => decrypt(bad)).toThrow();
});
