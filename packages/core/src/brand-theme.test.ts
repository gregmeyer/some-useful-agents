import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrandThemeError, DEFAULT_BRAND_THEME, brandThemeCss, brandThemeVersion, loadBrandTheme, resolveBrandTheme,
  restoreBrandThemeBackup, saveBrandTheme,
} from './brand-theme.js';

describe('brand theme', () => {
  it('the default theme writes only the accent variables', () => {
    const css = brandThemeCss(DEFAULT_BRAND_THEME);
    expect(css).toContain('--accent-teal: #2dd4bf;');
    expect(css).not.toContain('--color-');
    expect(css).not.toContain('[data-theme="light"]');
  });

  it('applies a preset, then overrides, for dark and light, with fonts, radius and accents', () => {
    const theme = { version: 1 as const, name: 'Acme', preset: 'warm' as const, dark: { primary: '#ff0066' }, light: { bg: 'rgb(250, 250, 250)' }, fonts: { sans: '"Inter", sans-serif' }, radius: { md: 4 }, accents: { teal: 'hsl(170, 60%, 50%)' } };
    const r = resolveBrandTheme(theme);
    expect(r.dark).toMatchObject({ primary: '#ff0066', bg: '#1c1917' }); // warm's bg, our primary
    expect(r.radius).toEqual({ sm: 8, md: 4, lg: 20 });
    const css = brandThemeCss(theme);
    expect(css).toMatch(/:root \{[^}]*--color-primary: #ff0066;[^}]*--font-sans: "Inter", sans-serif;[^}]*--radius-md: 4px;[^}]*--accent-teal: hsl\(170, 60%, 50%\);/s);
    expect(css).toMatch(/\[data-theme="light"\] \{[^}]*--color-bg: rgb\(250, 250, 250\);/s);
    expect(css).toContain('Brand theme: Acme');
  });

  it('refuses anything that could escape a CSS declaration', () => {
    for (const bad of [
      { dark: { primary: 'red; } body { display:none' } },
      { dark: { primary: 'url(https://evil.example/x)' } },
      { fonts: { sans: 'Inter; } * { color: red' } },
      { radius: { sm: 999 } },
      { dark: { nope: '#fff' } },
      { preset: 'rainbow' },
      { name: 'x', extra: true },
    ]) {
      expect(() => saveBrandTheme(mkdtempSync(join(tmpdir(), 'sua-brand-')), { version: 1, ...bad }), JSON.stringify(bad)).toThrow(BrandThemeError);
    }
  });

  it('saves with a version check, restores the previous theme, and falls back to default on a bad file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-brand-'));
    expect(loadBrandTheme(dir)).toEqual(DEFAULT_BRAND_THEME);
    expect(brandThemeVersion(dir)).toBe('');
    const a = saveBrandTheme(dir, { version: 1, preset: 'neon' }, { expectedVersion: '' });
    expect(loadBrandTheme(dir).preset).toBe('neon');
    expect(() => saveBrandTheme(dir, { version: 1, preset: 'warm' }, { expectedVersion: 'stale' })).toThrow(/changed since/);
    saveBrandTheme(dir, { version: 1, preset: 'warm' }, { expectedVersion: a.version });
    restoreBrandThemeBackup(dir);
    expect(loadBrandTheme(dir).preset).toBe('neon');
    mkdirSync(join(dir, '.sua'), { recursive: true });
    writeFileSync(join(dir, '.sua', 'theme.json'), '{"version":1,"dark":{"primary":"red; }"}}');
    expect(loadBrandTheme(dir)).toEqual(DEFAULT_BRAND_THEME);
  });
});

describe('saved brands', () => {
  it('saves, lists A–Z, applies (keeping Undo), knows which is in use, deletes, and skips bad files', async () => {
    const { listSavedBrands, saveBrandAs, applySavedBrand, deleteSavedBrand, isActiveBrand, loadBrandTheme, restoreBrandThemeBackup, brandsDir, brandId } = await import('./brand-theme.js');
    const dir = mkdtempSync(join(tmpdir(), 'sua-brands-'));
    expect(listSavedBrands(dir)).toEqual([]);
    saveBrandAs(dir, '  Zebra  Co ', { version: 1, preset: 'neon' });
    const acme = saveBrandAs(dir, 'Acme', { version: 1, preset: 'warm', dark: { primary: '#ff0066' } });
    expect(acme).toMatchObject({ id: 'acme', name: 'Acme' });
    expect(brandId('Zebra Co!')).toBe('zebra-co');
    mkdirSync(brandsDir(dir), { recursive: true });
    writeFileSync(join(brandsDir(dir), 'broken.json'), '{"version": 1, "dark": {"primary": "red; }"}}');
    expect(listSavedBrands(dir).map((b) => b.name)).toEqual(['Acme', 'Zebra Co']);
    expect(() => saveBrandAs(dir, '', {})).toThrow('Give the brand a name');
    expect(() => saveBrandAs(dir, 'Bad', { version: 1, dark: { primary: 'red; }' } })).toThrow('Not saved');

    applySavedBrand(dir, 'zebra-co');
    applySavedBrand(dir, 'acme');
    expect(loadBrandTheme(dir)).toMatchObject({ name: 'Acme', preset: 'warm' });
    expect(isActiveBrand(loadBrandTheme(dir), listSavedBrands(dir)[0].theme)).toBe(true);
    expect(isActiveBrand(loadBrandTheme(dir), listSavedBrands(dir)[1].theme)).toBe(false);
    restoreBrandThemeBackup(dir);
    expect(loadBrandTheme(dir).name).toBe('Zebra Co'); // Undo puts the previous brand back
    expect(() => applySavedBrand(dir, 'nope')).toThrow('That brand is gone');
    expect(deleteSavedBrand(dir, 'acme')).toBe(true);
    expect(deleteSavedBrand(dir, '../theme')).toBe(false);
    expect(listSavedBrands(dir).map((b) => b.id)).toEqual(['zebra-co']);
  });
});
