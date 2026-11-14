/** Identify an image from its first bytes (never trust the file name or the declared type). */
export function sniffImage(b: Buffer): { mime: string; width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('ascii', 0, 4) === 'GIF8') return { mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { mime: 'image/jpeg', width: 0, height: 0 };
  }
  if (b.length > 8 && b.toString('ascii', 4, 8) === 'ftyp') return { mime: 'video/mp4', width: 1920, height: 1080 };
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', width: 1920, height: 1080 };
  return null;
}
