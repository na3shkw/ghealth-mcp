import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icons } from '../src/icon.js';

describe('serverInfo のアイコン', () => {
  it('assets/logo-120.png と同じ内容を data URI で持つ', () => {
    const png = readFileSync(new URL('../assets/logo-120.png', import.meta.url));
    expect(icons[0].src).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(icons[0].mimeType).toBe('image/png');
  });
});
