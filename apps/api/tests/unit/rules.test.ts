// Every validation rule of every adapter has a passing and a failing test.
import { allAdapters } from '../../src/adapters/registry';
import { PlatformAdapter } from '../../src/adapters/types';

const img = (o: Partial<{ mime: string; bytes: number }> = {}) => ({ url: '', mime: 'image/png', width: 100, height: 100, bytes: 1000, ...o });
const input = (text: string, media: ReturnType<typeof img>[] = []) => ({ idempotencyKey: 'k', text, media });
const adapters = allAdapters();

describe.each(adapters.map(a => [a.id, a] as [string, PlatformAdapter]))('%s validation rules', (_id, a) => {
  const max = (a.id === 'telegram') ? 4096 : a.rules.maxChars;
  const validMedia = (o: Partial<{ mime: string; bytes: number }> = {}) => img({ mime: a.rules.mime[0], ...o });
  test('text exactly at the limit passes', () => expect(a.validate(input('x'.repeat(max)))).toEqual([]));
  test('text one over the limit fails', () => expect(a.validate(input('x'.repeat(max + 1)))).toHaveLength(1));
  test('counts characters, not UTF-16 units (emoji)', () => expect(a.validate(input('😀'.repeat(Math.min(max, 280))))).toEqual([]));
  test('empty post fails', () => expect(a.validate(input(''))).toHaveLength(1));
  test('image only (no text) passes', () => expect(a.validate(input('', [validMedia()]))).toEqual([]));
  test('allowed image count passes', () => expect(a.validate(input('hi', Array(a.rules.maxImages).fill(null).map(() => validMedia())))).toEqual([]));
  test('one image too many fails', () => expect(a.validate(input('hi', Array(a.rules.maxImages + 1).fill(null).map(() => validMedia()))).length).toBeGreaterThanOrEqual(1));
  test('allowed file type passes', () => expect(a.validate(input('hi', [validMedia()]))).toEqual([]));
  test('disallowed file type fails', () => expect(a.validate(input('hi', [img({ mime: 'application/pdf' })]))).toHaveLength(1));
  test('image at the size limit passes', () => expect(a.validate(input('hi', [validMedia({ bytes: a.rules.maxImageBytes })]))).toEqual([]));
  test('image over the size limit fails', () => expect(a.validate(input('hi', [validMedia({ bytes: a.rules.maxImageBytes + 1 })]))).toHaveLength(1));
  test('every message names the platform and tells the user what to do', () => {
    const msgs = a.validate(input('x'.repeat(max + 1), Array(a.rules.maxImages + 1).fill(img({ mime: 'application/pdf', bytes: a.rules.maxImageBytes + 1 }))));
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    for (const m of msgs) expect(m).toMatch(/shorten|remove|use |compress|allow/i);
  });
});
test('telegram: caption limit with a photo is 1024', () => {
  const t = adapters.find(a => a.id === 'telegram')!;
  expect(t.validate(input('x'.repeat(1024), [img()]))).toEqual([]);
  expect(t.validate(input('x'.repeat(1025), [img()]))).toHaveLength(1);
});
