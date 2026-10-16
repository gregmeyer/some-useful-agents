import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore, notebookViewData, type NotebookField } from '@some-useful-agents/core';
import { companyHost, companySite, findLogo, imageSize, pictureClass, pictureLabel, wantsLogos, type LogoDeps } from './notebook-logos.js';
import { applyPictures } from './notebook-pictures.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

/** A PNG header that says it's w×h. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

const JOB_FIELDS: NotebookField[] = [
  { key: 'salary', label: 'Salary', type: 'money', role: 'price' },
  { key: 'company', label: 'Company', type: 'text', role: 'org' },
  { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' },
];

describe('company logos', () => {
  it('knows a company’s own site from a job board, a recruiter or a careers page', () => {
    expect(companyHost('https://job-boards.greenhouse.io/acme/jobs/1')).toBeUndefined();
    expect(companyHost('https://jobs.lever.co/acme/9')).toBeUndefined();
    expect(companyHost('https://www.linkedin.com/jobs/view/1')).toBeUndefined();
    expect(companyHost('https://careers.acmepay.example/job/4')).toBe('acmepay.example');
    expect(companyHost('www.acmepay.example')).toBe('acmepay.example');
    expect(companyHost('Acme Pay')).toBeUndefined();
    expect(companySite(JOB_FIELDS, { company: 'Acme', posting_url: 'https://jobs.ashbyhq.com/acme/1' })).toBeUndefined();
    expect(companySite(JOB_FIELDS, { company: 'Acme', posting_url: 'https://acmepay.example/careers/controller' })).toBe('acmepay.example');
    expect(companySite([...JOB_FIELDS, { key: 'website', label: 'Website', type: 'url' }], { website: 'https://acmepay.example', posting_url: 'https://other.example/x' })).toBe('acmepay.example');
  });

  it('is for notebooks of jobs or companies, not cars', () => {
    expect(wantsLogos({ title: 'Find a controller job', statement: '', fields: JOB_FIELDS })).toBe(true);
    expect(wantsLogos({ title: 'Qualify 5 accounts', statement: '', fields: JOB_FIELDS })).toBe(true);
    expect(wantsLogos({ title: 'Find a used car', statement: '', fields: JOB_FIELDS })).toBe(false);
    expect(wantsLogos({ title: 'Find a controller job', statement: '', fields: JOB_FIELDS.filter((f) => f.role !== 'org') })).toBe(false);
  });

  it('reads an image’s size from its header', () => {
    expect(imageSize(png(180, 180))).toEqual({ width: 180, height: 180 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 16, 0, 16, 0]))).toEqual({ width: 16, height: 16 });
    // A JPEG: SOI, an APP0 segment, then SOF0 with 120×64.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 64, 0, 120, 3, 1, 1, 1]);
    expect(imageSize(jpeg)).toEqual({ width: 120, height: 64 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it('takes the site’s own icon first, skips a favicon too small to read, and falls back to a 128px favicon', async () => {
    const fetched: string[] = [];
    const deps = (sizes: Record<string, number>, icons: string[]): LogoDeps => ({
      siteIcons: async () => icons,
      fetchImage: async (u) => {
        fetched.push(u);
        const px = Object.entries(sizes).find(([k]) => u.includes(k))?.[1];
        if (!px) throw new Error('HTTP 404');
        return { bytes: png(px, px), contentType: 'image/png' };
      },
    });
    expect(await findLogo('acmepay.example', deps({ 'apple-touch': 180 }, ['https://acmepay.example/apple-touch.png']))).toMatchObject({ url: 'https://acmepay.example/apple-touch.png', contentType: 'image/png' });
    fetched.length = 0;
    const small = await findLogo('acmepay.example', deps({ 'icon-32': 32, s2: 128 }, ['https://acmepay.example/icon-32.png']));
    expect(small?.url).toBe('https://www.google.com/s2/favicons?domain=acmepay.example&sz=128');
    expect(fetched).toEqual(['https://acmepay.example/icon-32.png', 'https://www.google.com/s2/favicons?domain=acmepay.example&sz=128']);
    // Google's default 16px globe for a site it doesn't know isn't a logo.
    expect(await findLogo('nowhere.example', deps({ s2: 16 }, []))).toBeUndefined();
  });

  it('a logo shows whole on a tile and needs no "example photo" word', () => {
    expect(pictureClass('logo')).toBe('is-drawn is-logo');
    expect(pictureClass('illustration')).toBe('is-drawn');
    expect(pictureClass('listing')).toBe('');
    expect(pictureLabel('logo')).toBeUndefined();
    expect(pictureLabel('representative')).toBe('example photo');
  });

  it('in a job notebook, the picture pass keeps logos first (the agent’s site, else the option’s own), then photos, then drawings', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-logos-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Find a controller job' }).id, JOB_FIELDS);
    const add = (t: string, data: Record<string, unknown>) => s.upsertOption(nb.id, { title: t, by: 'agent:x', data }).entry;
    const named = add('Controller, Acme Pay', { company: 'Acme Pay', posting_url: 'https://job-boards.greenhouse.io/acmepay/jobs/1' });
    const own = add('Controller, Birch Labs', { company: 'Birch Labs', posting_url: 'https://careers.birchlabs.example/jobs/7' });
    const photo = add('Controller, Cedar Co', { company: 'Cedar Co', posting_url: 'https://jobs.lever.co/cedar/2' });
    const none = add('Controller, Dune Inc', { company: 'Dune Inc', posting_url: 'https://jobs.lever.co/dune/3' });
    const asked = [named.id, own.id, photo.id, none.id];
    const logoDeps: LogoDeps = {
      siteIcons: async (u) => (u.includes('acmepay') || u.includes('birchlabs') ? [`${u}apple-touch-icon.png`] : []),
      fetchImage: async (u) => {
        if (u.includes('apple-touch-icon')) return { bytes: png(180, 180), contentType: 'image/png' };
        if (u.includes('s2/favicons')) return { bytes: png(16, 16), contentType: 'image/png' };
        throw new Error('HTTP 404');
      },
    };
    const raw = `<pictures>${JSON.stringify({ items: [
      { id: named.id, site: 'https://www.acmepay.example', what: "Acme Pay's website" },
      { id: photo.id, url: 'https://upload.wikimedia.org/x/Cedar_logo.png', what: 'Cedar Co logo' },
      { id: none.id, site: 'jobs.lever.co', what: 'only a job board' },
    ] })}</pictures>`;
    const sites = { [named.id]: companySite(JOB_FIELDS, named.data), [own.id]: companySite(JOB_FIELDS, own.data), [photo.id]: undefined, [none.id]: undefined };
    const out = await applyPictures(s, nb.id, asked, raw, { fetchImage: async () => ({ bytes: png(400, 300), contentType: 'image/png' }) }, [0], { sites, deps: logoDeps });
    expect(out).toEqual({ kept: 4, found: 1, drawn: 1, logos: 2 });
    expect(s.photo(named.id)).toMatchObject({ kind: 'logo', what: 'acmepay.example logo', sourceUrl: 'https://acmepay.example/apple-touch-icon.png' });
    expect(s.photo(own.id)).toMatchObject({ kind: 'logo', what: 'birchlabs.example logo' });
    expect(s.photo(photo.id)).toMatchObject({ kind: 'logo', what: 'Cedar Co logo' });   // the agent's find, as a logo
    expect(s.photo(none.id)!.kind).toBe('illustration');
    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options;
    expect(v.find((o) => o.id === named.id)?.imageKind).toBe('logo');
    // Without the agent's answer, the options' own sites still give logos.
    const late = add('Controller, Elm Works', { company: 'Elm Works', posting_url: 'https://careers.birchlabs.example/jobs/9' });
    const again = await applyPictures(s, nb.id, [late.id], '', undefined, [0], { sites: { [late.id]: 'birchlabs.example' }, deps: logoDeps });
    expect(again.logos).toBe(1);
    // An example photo the agent said was a logo (kept before logos were their own kind) becomes one.
    s.savePhoto(nb.id, none.id, 'https://x.example/dune.png', { contentType: 'image/png', bytes: png(200, 200) }, { kind: 'representative', what: 'Dune Inc logo from its site' });
    expect(s.relabelLogos(nb.id)).toBe(1);
    expect(s.photo(none.id)!.kind).toBe('logo');
  });
});
