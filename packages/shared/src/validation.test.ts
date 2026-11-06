import { describe, expect, it } from 'vitest';
import { cleanChat } from './net/protocol';
import { passwordStrength, validatePassword } from './validation';

describe('passwords', () => {
  it('needs length, both cases, a number and a symbol, and not the username', () => {
    expect(validatePassword('short1!A')).not.toBeNull();
    expect(validatePassword('alllowercase1!')).not.toBeNull();
    expect(validatePassword('NoNumbersHere!')).not.toBeNull();
    expect(validatePassword('NoSymbols123x')).not.toBeNull();
    expect(validatePassword('Painty!Rocks42', 'painty')).not.toBeNull();
    expect(validatePassword('Splaaaash!Go42')).not.toBeNull();
    expect(validatePassword('Splash!Test42x')).toBeNull();
    expect(passwordStrength('Splash!Test42x')).toBeGreaterThanOrEqual(3);
  });
});

describe('chat', () => {
  it('strips control characters and caps the length', () => {
    expect(cleanChat('  hi\u0000 there\n  ')).toBe('hi there');
    expect(cleanChat('x'.repeat(500))).toHaveLength(120);
    expect(cleanChat(42)).toBe('');
  });
});
