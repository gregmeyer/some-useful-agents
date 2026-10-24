/**
 * Settings > Appearance (docs/brand.md): the look now (a light and a dark
 * preview), a gallery of your brands and the presets (one click uses one),
 * Make one with sua, and Fine-tune with colour pickers.
 */

import { html, unsafeHtml, type SafeHtml } from './html.js';
import { THEMES } from './themes.js';
import type { BrandColorToken, BrandTheme, resolveBrandTheme } from '@some-useful-agents/core';

export interface BrandFormInput {
  theme: BrandTheme;
  version: string;
  hasBackup: boolean;
  /** Effective (preset + overrides) colours, to show what each field currently is. */
  effective: ReturnType<typeof resolveBrandTheme>;
  /** Each preset's own values (no overrides): its gallery card, and Fine-tune's "the preset's" hints. */
  presets?: Record<string, ReturnType<typeof resolveBrandTheme>>;
  /** Saved brands, with their effective colours and whether each is the one in use. */
  saved?: Array<{ id: string; name: string; active: boolean; effective: ReturnType<typeof resolveBrandTheme> }>;
  /** sua's brand proposal (Update my brand), if there is one. */
  proposal?: BrandProposalView;
}

export type BrandProposalView =
  | { status: 'working'; source: string }
  | { status: 'failed'; source: string; error: string }
  | { status: 'ready'; source: string; why?: string; issues: string[]; name?: string; effective: ReturnType<typeof resolveBrandTheme> };

type Effective = ReturnType<typeof resolveBrandTheme>;

/** sua's own tokens (assets/tokens.css), for whatever a theme leaves to them. */
const BASE: Record<'dark' | 'light', Record<string, string>> = {
  dark: { bg: '#1a1918', surface: '#242220', 'surface-raised': '#2e2c2a', border: '#3d3a37', text: '#e7e5e4', 'text-muted': '#a8a29e', primary: '#2dd4bf', ok: '#4ade80', warn: '#fbbf24', err: '#f87171' },
  light: { bg: '#faf9f7', surface: '#ffffff', 'surface-raised': '#f5f4f2', border: '#e7e5e4', text: '#1c1917', 'text-muted': '#78716c', primary: '#0f766e', ok: '#15803d', warn: '#b45309', err: '#b91c1c' },
};
const BASE_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const BASE_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const BASE_RADIUS = { sm: 6, md: 10, lg: 14 };

/** The preview's CSS variables for one mode: the theme's values, else sua's own (all schema-checked). */
function previewVars(e: Effective, mode: 'dark' | 'light'): string {
  const t = { ...BASE[mode], ...(e[mode] as Record<string, string | undefined>) } as Record<string, string>;
  const vars: Record<string, string> = {
    '--p-bg': t.bg, '--p-surface': t.surface, '--p-surface-raised': t['surface-raised'], '--p-border': t.border,
    '--p-text': t.text, '--p-text-muted': t['text-muted'], '--p-primary': t.primary,
    '--p-ok': t.ok, '--p-warn': t.warn, '--p-err': t.err,
    '--p-font': e.fonts.sans ?? BASE_FONT, '--p-display': e.fonts.display ?? e.fonts.mono ?? BASE_MONO,
    '--p-r': `${String(e.radius.md ?? BASE_RADIUS.md)}px`,
  };
  for (const [k, v] of Object.entries(e.accents)) vars[`--p-a-${k}`] = v;
  return Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('; ');
}

/**
 * A small dashboard drawn in a look's colours, for one mode: a top bar, a card
 * with a status and a button, and the tile accents. `hero` is the big one at
 * the top (Fine-tune redraws it as you edit); `card` is a gallery thumbnail.
 */
function brandPreview(e: Effective, mode: 'dark' | 'light', size: 'hero' | 'card' = 'hero'): SafeHtml {
  return html`<div class="bp bp--${size}" data-preview-mode="${mode}" style="${previewVars(e, mode)}" aria-hidden="true">
      <div class="bp__top"><span class="bp__logo">sua</span>${size === 'hero' ? html`<span class="bp__nav">Notebooks · Agents · Pulse</span>` : html``}<span class="bp__mode">${mode === 'dark' ? 'Dark' : 'Light'}</span></div>
      <div class="bp__body">
        <div class="bp__card">
          <span class="bp__title">Weekly digest</span>
          ${size === 'hero' ? html`<span class="bp__muted">3 runs today · last one 2m ago</span>
          <span class="bp__chips"><span class="bp__chip bp__chip--ok">All fine</span><span class="bp__chip bp__chip--warn">1 slow</span><span class="bp__chip bp__chip--err">0 failed</span></span>` : html``}
          <span class="bp__row"><span class="bp__btn">Run now</span>${size === 'hero' ? html`<span class="bp__link">Open</span>` : html``}</span>
        </div>
        <span class="bp__accents">${Object.keys(e.accents).map((k) => html`<span style="background: var(--p-a-${k});"></span>`) as unknown as SafeHtml[]}</span>
      </div>
    </div>`;
}

/** Update my brand: ask sua for a brand from a website or a few words, preview it, use it or not. */
function renderBrandMaker(brand: BrandFormInput): SafeHtml {
  const p = brand.proposal;
  const ask = html`<form method="POST" action="/settings/appearance/brand/propose" class="brand-maker__ask">
      <label class="sr-only" for="brand-maker-source">A website or a few words</label>
      <input id="brand-maker-source" type="text" name="source" required maxlength="500" value="${p && p.status !== 'working' ? p.source : ''}" placeholder="https://yourcompany.com, or: calm navy and coral, rounded">
      <button type="submit" class="btn btn--sm btn--primary"${unsafeHtml(p?.status === 'working' ? ' disabled' : '')}>${p && p.status !== 'working' ? 'Try again' : 'Make my brand'}</button>
    </form>`;
  let body: SafeHtml = html``;
  if (p?.status === 'working') {
    body = html`<p class="brand-maker__status" data-brand-working>sua is making a brand from <strong>${p.source}</strong>. This takes a minute or so; the page updates when it's ready.</p>
      ${unsafeHtml(`<script>(function(){var n=0;var t=setInterval(function(){n++;fetch('/settings/appearance/brand/proposal',{headers:{Accept:'application/json'}}).then(function(r){return r.json()}).then(function(j){if(!j||j.status!=='working'||n>120){clearInterval(t);location.reload();}}).catch(function(){});},3000);})();</script>`)}`;
  } else if (p?.status === 'failed') {
    body = html`<p class="flash flash--error" style="margin: 0;">${p.error}</p>`;
  } else if (p?.status === 'ready') {
    body = html`
      <div class="brand-maker__result">
        <p class="brand-maker__why"><strong>${p.name ?? 'A brand'}</strong>${p.why ? html` · ${p.why}` : html``}</p>
        <div class="brand-maker__previews">${brandPreview(p.effective, 'light', 'card')}${brandPreview(p.effective, 'dark', 'card')}</div>
        ${p.issues.length ? html`<ul class="brand-maker__issues">${p.issues.map((i) => html`<li>${i}</li>`) as unknown as SafeHtml[]}</ul>` : html`<p class="brand-maker__ok">Text and accents are readable in both modes.</p>`}
        <div class="brand-maker__actions">
          <form method="POST" action="/settings/appearance/brand/proposal/use"><input type="hidden" name="version" value="${brand.version}">
            <button type="submit" class="btn btn--sm btn--primary">Use this brand</button></form>
          <form method="POST" action="/settings/appearance/brand/proposal/discard"><button type="submit" class="btn btn--sm btn--ghost">Discard</button></form>
          <span class="brand-maker__hint">Nothing changes until you use it. Undo last change puts the current look back.</span>
        </div>
      </div>`;
  }
  return html`<section class="brand-maker" aria-labelledby="brand-maker-title">
      <h3 id="brand-maker-title" class="look-section__title">Make one with sua</h3>
      <p class="brand-maker__lede">Paste your website or describe the look ("calm navy and coral, rounded"). sua proposes colours for both modes, fonts, corners and accents, and you see it before anything changes.</p>
      ${ask}
      ${body}
    </section>`;
}

/** The colour tokens the form offers (the rest stay editable in .sua/theme.json). */
/** Fine-tune's colours: the four that make the look, then the rest under More colours. */
const KEY_TOKENS: Array<[BrandColorToken, string]> = [['primary', 'Accent'], ['bg', 'Background'], ['surface', 'Cards'], ['text', 'Text']];
const MORE_TOKENS: Array<[BrandColorToken, string]> = [
  ['surface-raised', 'Raised cards'], ['border', 'Borders'], ['text-muted', 'Muted text'],
  ['ok', 'Good'], ['warn', 'Warning'], ['err', 'Error'],
];

/** Font choices for Fine-tune; "" keeps the preset's, anything else typed is Custom. */
const FONT_CHOICES: Array<[string, string]> = [
  ['system-ui, -apple-system, "Segoe UI", sans-serif', 'System'],
  ['"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif', 'Clean sans (Inter, Helvetica)'],
  ['"Charter", "Iowan Old Style", Georgia, "Times New Roman", serif', 'Serif (Charter, Georgia)'],
  ['"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace', 'Monospace'],
];

/** A theme that only names a preset (nothing of its own on top). */
function plainPreset(t: BrandTheme): boolean {
  const own = (o: object | undefined) => !!o && Object.keys(o).length > 0;
  return !t.name && !own(t.dark) && !own(t.light) && !own(t.fonts) && !own(t.radius) && !own(t.accents);
}

/** #rrggbb for a colour picker; anything else (rgb(), hsl()) leaves the picker at the fallback. */
const hex = (v: string | undefined, fallback: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v ?? '') ? `#${v!.slice(1).split('').map((c) => c + c).join('')}` : fallback);

export function renderSettingsAppearance(opts: { brand?: BrandFormInput; applied?: boolean } = {}): SafeHtml {
  const brand = opts.brand;
  if (!brand) return html`<div><h2 id="brand">Appearance</h2><p class="dim">The brand theme isn't available.</p></div>`;
  const t = brand.theme;
  const presetName = (id: string) => THEMES.find((x) => x.id === id)?.name ?? id;
  const nowName = t.name ?? (plainPreset(t) ? presetName(t.preset) : `Your own look, from ${presetName(t.preset)}`);
  const presets = brand.presets ?? {};
  const saved = brand.saved ?? [];
  const presetCards = THEMES.filter((x) => x.id !== 'light' && presets[x.id]);

  // ── 1. The look now ──
  const lookNow = html`
    <section class="look-now" aria-labelledby="look-now-title">
      <div class="look-now__head">
        <div>
          <span class="look-section__eyebrow">The look now</span>
          <h3 class="look-now__name" id="look-now-title">${nowName}</h3>
        </div>
        <div class="look-now__acts">
          ${brand.hasBackup ? html`<form method="POST" action="/settings/appearance/brand/undo"><input type="hidden" name="version" value="${brand.version}">
            <button type="submit" class="btn btn--sm${opts.applied ? ' btn--primary' : ''}">Undo last change</button></form>` : html``}
          <form method="POST" action="/settings/appearance/brand"><input type="hidden" name="version" value="${brand.version}">
            <button type="submit" class="btn btn--sm btn--ghost" name="reset" value="1">Reset to sua's default</button></form>
        </div>
      </div>
      <div class="look-now__previews" data-look-previews>${brandPreview(brand.effective, 'light')}${brandPreview(brand.effective, 'dark')}</div>
      <form method="POST" action="/settings/appearance/brands/save" class="look-now__save">
        <label for="brand-save-name">Keep this look as a brand</label>
        <input id="brand-save-name" type="text" name="name" required maxlength="60" value="${t.name ?? ''}" placeholder="Name it, e.g. Acme">
        <button type="submit" class="btn btn--sm">Save as a brand</button>
      </form>
    </section>`;

  // ── 2. Pick a look: your brands, then the presets. One click uses it. ──
  const card = (name: string, e: Effective, active: boolean, action: string, desc?: string, del?: string) => html`
    <li class="look-card${active ? ' is-active' : ''}">
      <form method="POST" action="${action}">
        <input type="hidden" name="version" value="${brand.version}">
        <button type="submit" class="look-card__use"${unsafeHtml(active ? ' aria-current="true" disabled' : '')} aria-label="${active ? `${name}, in use` : `Use ${name}`}">
          <span class="look-card__previews">${brandPreview(e, 'light', 'card')}${brandPreview(e, 'dark', 'card')}</span>
          <span class="look-card__name">${name}${active ? html`<span class="look-card__badge">In use</span>` : html``}</span>
          ${desc ? html`<span class="look-card__desc">${desc}</span>` : html``}
        </button>
      </form>
      ${del ? html`<form method="POST" action="${del}" class="look-card__del"><button type="submit" class="btn btn--sm btn--ghost" aria-label="Delete the ${name} brand">Delete</button></form>` : html``}
    </li>`;
  const gallery = html`
    <section class="look-section" aria-labelledby="look-pick-title">
      <h3 class="look-section__title" id="look-pick-title">Pick a look</h3>
      <p class="look-section__lede">One click changes every page, board and tile. Undo puts the last one back.</p>
      ${saved.length ? html`<h4 class="look-section__sub" id="brands-title">Your brands</h4>
      <ul class="look-gallery">${saved.map((b) => card(b.name, b.effective, b.active, `/settings/appearance/brands/${encodeURIComponent(b.id)}/apply`, undefined, `/settings/appearance/brands/${encodeURIComponent(b.id)}/delete`)) as unknown as SafeHtml[]}</ul>` : html``}
      <h4 class="look-section__sub"${unsafeHtml(saved.length ? '' : ' id="brands-title"')}>${saved.length ? 'Presets' : 'Presets (your saved brands show here too)'}</h4>
      <ul class="look-gallery">${presetCards.map((x) => card(x.name, presets[x.id], plainPreset(t) && t.preset === x.id, `/settings/appearance/presets/${encodeURIComponent(x.id)}/apply`, x.description)) as unknown as SafeHtml[]}</ul>
    </section>`;

  // ── 4. Fine-tune ──
  const colorField = (mode: 'dark' | 'light', token: BrandColorToken, label: string) => {
    const own = t[mode]?.[token] ?? '';
    const base = (presets[t.preset]?.[mode] as Record<string, string | undefined> | undefined)?.[token] ?? BASE[mode][token] ?? '';
    const id = `tune-${mode}-${token}`;
    return html`<div class="tune-color">
        <input type="color" class="tune-color__pick" value="${hex(own || base, '#888888')}" data-pick-for="${id}" aria-label="${label} (${mode}) colour">
        <label class="tune-color__label" for="${id}">${label}</label>
        <input id="${id}" type="text" name="${mode}.${token}" value="${own}" placeholder="${base || 'preset'}" data-base="${base}" spellcheck="false" autocomplete="off" class="tune-color__text">
        <button type="button" class="tune-color__clear" data-clear="${id}" title="Back to the preset's" aria-label="${label}: back to the preset's"${unsafeHtml(own ? '' : ' hidden')}>×</button>
      </div>`;
  };
  const modePanel = (mode: 'dark' | 'light') => html`
      <div class="tune-mode" data-tune-mode="${mode}"${unsafeHtml(mode === 'light' ? ' hidden' : '')}>
        <div class="tune-colors">${KEY_TOKENS.map(([k, l]) => colorField(mode, k, l)) as unknown as SafeHtml[]}</div>
        <details class="tune-more"><summary>More colours</summary>
          <div class="tune-colors">${MORE_TOKENS.map(([k, l]) => colorField(mode, k, l)) as unknown as SafeHtml[]}</div>
          <p class="tune-hint">Type a colour as <code>#rrggbb</code>, <code>rgb(…)</code>, <code>hsl(…)</code> or <code>transparent</code>, or use the swatch. × goes back to the preset's.</p>
        </details>
      </div>`;
  const fontField = (key: 'sans' | 'display', label: string) => {
    const own = t.fonts[key] ?? '';
    const known = FONT_CHOICES.some(([v]) => v === own);
    const presetFont = presets[t.preset]?.fonts[key];
    return html`<div class="tune-font">
        <label for="tune-font-${key}">${label}</label>
        <select id="tune-font-${key}" data-font-for="tune-fonts-${key}">
          <option value=""${unsafeHtml(own ? '' : ' selected')}>The preset's${presetFont ? ` (${presetFont.split(',')[0].replace(/"/g, '')})` : key === 'display' ? ' (the code font)' : ' (System)'}</option>
          ${FONT_CHOICES.map(([v, l]) => html`<option value="${v}"${unsafeHtml(own === v ? ' selected' : '')}>${l}</option>`) as unknown as SafeHtml[]}
          <option value="custom"${unsafeHtml(own && !known ? ' selected' : '')}>Custom…</option>
        </select>
        <input id="tune-fonts-${key}" type="text" name="fonts.${key}" value="${own}" placeholder="Font families, separated by commas" spellcheck="false"${unsafeHtml(own && !known ? '' : ' hidden')}>
      </div>`;
  };
  const r = t.radius;
  const eff = brand.effective.radius;
  const roundness = eff.md ?? BASE_RADIUS.md;
  const tune = html`
    <details class="tune" id="tune">
      <summary class="tune__summary"><span class="look-section__title">Fine-tune</span><span class="tune__lede">Change colours, corners and fonts. The preview above follows as you go.</span></summary>
      <form method="POST" action="/settings/appearance/brand" class="brand-form tune__form" data-tune>
        <input type="hidden" name="version" value="${brand.version}">
        <input type="hidden" name="preset" value="${t.preset}">
        <input type="hidden" name="name" value="${t.name ?? ''}">
        <div class="tune__section">
          <div class="tune__tabs" role="group" aria-label="Which mode to edit">
            <button type="button" class="tune__tab" aria-pressed="true" data-tune-tab="dark">Dark mode</button>
            <button type="button" class="tune__tab" aria-pressed="false" data-tune-tab="light">Light mode</button>
          </div>
          ${modePanel('dark')}${modePanel('light')}
        </div>
        <div class="tune__section tune__shape">
          <div class="tune-round">
            <label for="tune-round">Corners <output data-round-out>${String(roundness)}px</output></label>
            <input id="tune-round" type="range" min="0" max="24" step="1" value="${String(roundness)}" data-round>
            <span class="tune-round__marks" aria-hidden="true"><span>Sharp</span><span>Soft</span><span>Round</span></span>
            <input type="hidden" name="radius.sm" value="${r.sm !== undefined ? String(r.sm) : ''}" data-radius="sm">
            <input type="hidden" name="radius.md" value="${r.md !== undefined ? String(r.md) : ''}" data-radius="md">
            <input type="hidden" name="radius.lg" value="${r.lg !== undefined ? String(r.lg) : ''}" data-radius="lg">
          </div>
          ${fontField('sans', 'Text font')}
          ${fontField('display', 'Heading font')}
        </div>
        <div class="tune__section">
          <span class="tune__label">Tile accents</span>
          <div class="tune-accents">${BRAND_ACCENTS_LIST.map((name) => {
            const own = (t.accents as Record<string, string | undefined>)[name] ?? '';
            const shown = (brand.effective.accents as Record<string, string>)[name] ?? '';
            return html`<label class="tune-accent"><input type="color" value="${hex(own || shown, '#888888')}" data-accent="${name}" aria-label="${name} tile accent"><span>${name}</span>
              <input type="hidden" name="accents.${name}" value="${own}"></label>`;
          }) as unknown as SafeHtml[]}</div>
        </div>
        <details class="tune-more"><summary>More: code font</summary>
          <div class="tune-font"><label for="tune-fonts-mono">Code font</label>
            <input id="tune-fonts-mono" type="text" name="fonts.mono" value="${t.fonts.mono ?? ''}" placeholder="${brand.effective.fonts.mono ?? 'JetBrains Mono, monospace'}" spellcheck="false"></div>
        </details>
        <div class="tune__save">
          <button type="submit" class="btn btn--primary btn--sm">Save changes</button>
          <span class="tune__dirty" data-tune-dirty hidden>Not saved yet</span>
          <span class="tune__hint">Saves both modes. Undo last change puts the previous look back.</span>
        </div>
      </form>
    </details>`;

  return html`
    <div class="appearance" id="brand">
      <h2 class="appearance__title">Appearance</h2>
      <p class="appearance__lede">One look for the whole dashboard, in every browser. Pick one, have sua make one, or fine-tune the one you have. The light/dark switch in the top bar picks the mode. <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/brand.md">Brand guide</a></p>
      ${lookNow}
      ${gallery}
      ${renderBrandMaker(brand)}
      ${tune}
      ${unsafeHtml(`<script>${TUNE_JS}</script>`)}
    </div>`;
}

const BRAND_ACCENTS_LIST = ['teal', 'blue', 'green', 'orange', 'red', 'purple'] as const;

// Fine-tune in the browser: Dark/Light tabs, swatch ↔ text, × back to the
// preset's, corners from one slider, fonts from a list, and the hero
// previews redrawn from the form as you edit (only the previews; the page
// changes when you save).
const TUNE_JS = `(function () {
  var form = document.querySelector('[data-tune]');
  if (!form) return;
  var details = form.closest('details');
  if (details && (location.hash === '#tune' || /[?&]tuned=1/.test(location.search))) details.open = true;
  var dirty = form.querySelector('[data-tune-dirty]');
  function changed() { if (dirty) dirty.hidden = false; redraw(); }
  form.querySelectorAll('[data-tune-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-tune-tab');
      form.querySelectorAll('[data-tune-tab]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      form.querySelectorAll('[data-tune-mode]').forEach(function (p) { p.hidden = p.getAttribute('data-tune-mode') !== m; });
    });
  });
  form.querySelectorAll('[data-pick-for]').forEach(function (pick) {
    var text = document.getElementById(pick.getAttribute('data-pick-for'));
    var clear = form.querySelector('[data-clear="' + text.id + '"]');
    pick.addEventListener('input', function () { text.value = pick.value; if (clear) clear.hidden = false; changed(); });
    text.addEventListener('input', function () {
      if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) pick.value = text.value.trim();
      if (clear) clear.hidden = !text.value; changed();
    });
    if (clear) clear.addEventListener('click', function () {
      text.value = ''; clear.hidden = true;
      if (/^#[0-9a-f]{6}$/i.test(text.getAttribute('data-base') || '')) pick.value = text.getAttribute('data-base');
      changed();
    });
  });
  var round = form.querySelector('[data-round]');
  var out = form.querySelector('[data-round-out]');
  if (round) round.addEventListener('input', function () {
    var r = Number(round.value);
    var set = function (k, v) { var f = form.querySelector('[data-radius="' + k + '"]'); if (f) f.value = String(Math.round(v)); };
    set('sm', r * 0.6); set('md', r); set('lg', r * 1.4);
    if (out) out.textContent = r + 'px';
    changed();
  });
  form.querySelectorAll('[data-font-for]').forEach(function (sel) {
    var text = document.getElementById(sel.getAttribute('data-font-for'));
    sel.addEventListener('change', function () {
      if (sel.value === 'custom') { text.hidden = false; text.focus(); }
      else { text.hidden = true; text.value = sel.value; }
      changed();
    });
    text.addEventListener('input', changed);
  });
  form.querySelectorAll('[data-accent]').forEach(function (pick) {
    var hidden = form.querySelector('input[name="accents.' + pick.getAttribute('data-accent') + '"]');
    pick.addEventListener('input', function () { if (hidden) hidden.value = pick.value; changed(); });
  });
  var mono = form.querySelector('input[name="fonts.mono"]');
  if (mono) mono.addEventListener('input', changed);
  function val(name) { var f = form.querySelector('[name="' + name + '"]'); return f ? f.value.trim() : ''; }
  function redraw() {
    document.querySelectorAll('[data-look-previews] [data-preview-mode]').forEach(function (p) {
      var mode = p.getAttribute('data-preview-mode');
      form.querySelectorAll('input[name^="' + mode + '."]').forEach(function (f) {
        var v = f.value.trim() || f.getAttribute('data-base');
        if (v) p.style.setProperty('--p-' + f.name.slice(mode.length + 1), v);
      });
      if (val('fonts.sans')) p.style.setProperty('--p-font', val('fonts.sans'));
      if (val('fonts.display')) p.style.setProperty('--p-display', val('fonts.display'));
      if (val('radius.md')) p.style.setProperty('--p-r', val('radius.md') + 'px');
      form.querySelectorAll('input[name^="accents."]').forEach(function (f) { if (f.value) p.style.setProperty('--p-a-' + f.name.slice(8), f.value); });
    });
  }
  window.addEventListener('beforeunload', function (e) { if (dirty && !dirty.hidden && !form.__sending) { e.preventDefault(); e.returnValue = ''; } });
  form.addEventListener('submit', function () { form.__sending = true; });
})();`;
