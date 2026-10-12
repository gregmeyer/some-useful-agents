/**
 * Settings > Appearance: the brand theme (docs/brand.md), the widget renderer,
 * and boards.
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
  /** Saved brands, with their effective colours and whether each is the one in use. */
  saved?: Array<{ id: string; name: string; active: boolean; effective: ReturnType<typeof resolveBrandTheme> }>;
  /** sua's brand proposal (Update my brand), if there is one. */
  proposal?: BrandProposalView;
}

/** A saved brand's colours as a strip: accent, page, surface, text (light), then accent (dark). */
function brandStrip(e: ReturnType<typeof resolveBrandTheme>): SafeHtml {
  // A theme stores only what differs from sua's own tokens (tokens.css); fill the rest from them.
  const BASE: Record<'dark' | 'light', Partial<Record<BrandColorToken, string>>> = {
    light: { primary: '#0f766e', bg: '#faf9f7', surface: '#ffffff', text: '#1c1917' },
    dark: { primary: '#2dd4bf', bg: '#1a1918', surface: '#242220', text: '#e7e5e4' },
  };
  const c = (mode: 'dark' | 'light', k: BrandColorToken) => (e[mode] as Record<string, string | undefined>)[k] ?? BASE[mode][k] ?? '';
  const sw = [c('light', 'primary'), c('light', 'bg'), c('light', 'surface'), c('light', 'text'), c('dark', 'bg'), c('dark', 'primary')].filter(Boolean);
  return html`<span class="brand-strip" aria-hidden="true">${sw.map((s) => html`<span style="background: ${s};"></span>`) as unknown as SafeHtml[]}</span>`;
}

/** Your saved brands: switch with one click, keep the current look under a name. */
function renderSavedBrands(brand: BrandFormInput): SafeHtml {
  const saved = brand.saved ?? [];
  return html`
    <section class="brands" aria-labelledby="brands-title">
      <div class="brands__head">
        <h3 id="brands-title" class="brands__title">Your brands</h3>
        <form method="POST" action="/settings/appearance/brands/save" class="brands__save">
          <label class="sr-only" for="brand-save-name">Brand name</label>
          <input id="brand-save-name" type="text" name="name" required maxlength="60" value="${brand.theme.name ?? ''}" placeholder="Name this look, e.g. Acme">
          <button type="submit" class="btn btn--sm">Save as a brand</button>
        </form>
      </div>
      ${saved.length === 0
        ? html`<p class="brands__empty">No saved brands yet. Set the look below, then <strong>Save as a brand</strong> to keep it, and switch between brands here.</p>`
        : html`<ul class="brands__list">${saved.map((b) => html`
          <li class="brands__item${b.active ? ' is-active' : ''}">
            ${brandStrip(b.effective)}
            <span class="brands__name">${b.name}</span>
            ${b.active ? html`<span class="brands__badge">In use</span>` : html`
              <form method="POST" action="/settings/appearance/brands/${encodeURIComponent(b.id)}/apply">
                <input type="hidden" name="version" value="${brand.version}">
                <button type="submit" class="btn btn--sm btn--primary">Use this</button>
              </form>`}
            <form method="POST" action="/settings/appearance/brands/${encodeURIComponent(b.id)}/delete">
              <button type="submit" class="btn btn--sm btn--ghost" aria-label="Delete the ${b.name} brand">Delete</button>
            </form>
          </li>`) as unknown as SafeHtml[]}</ul>`}
    </section>`;
}

export type BrandProposalView =
  | { status: 'working'; source: string }
  | { status: 'failed'; source: string; error: string }
  | { status: 'ready'; source: string; why?: string; issues: string[]; name?: string; effective: ReturnType<typeof resolveBrandTheme> };

/** A small page drawn in the proposed colours, for one mode. Colours are schema-checked. */
function brandPreview(e: ReturnType<typeof resolveBrandTheme>, mode: 'dark' | 'light'): SafeHtml {
  const base = mode === 'dark'
    ? { bg: '#1a1918', surface: '#242220', border: '#3a3633', text: '#e7e5e4', 'text-muted': '#a8a29e', primary: '#2dd4bf', 'primary-soft': '#134e4a' }
    : { bg: '#faf9f7', surface: '#ffffff', border: '#e7e5e4', text: '#1c1917', 'text-muted': '#78716c', primary: '#0f766e', 'primary-soft': '#ccfbf1' };
  const t = { ...base, ...(e[mode] as Record<string, string | undefined>) } as Record<string, string>;
  const font = e.fonts.sans ?? 'system-ui, sans-serif';
  const r = e.radius.md ?? 10;
  const accents = Object.values(e.accents).slice(0, 4);
  return html`<div class="brand-preview" style="background: ${t.bg}; color: ${t.text}; font-family: ${font};">
      <span class="brand-preview__mode" style="color: ${t['text-muted']};">${mode === 'dark' ? 'Dark' : 'Light'}</span>
      <div class="brand-preview__card" style="background: ${t.surface}; border: 1px solid ${t.border}; border-radius: ${String(r)}px;">
        <strong>Weekly digest</strong>
        <span style="color: ${t['text-muted']};">3 runs today, all fine</span>
        <span class="brand-preview__row">
          <span class="brand-preview__btn" style="background: ${t.primary}; color: ${t.bg}; border-radius: ${String(Math.max(2, r - 4))}px;">Run now</span>
          <span style="color: ${t.primary};">Open</span>
        </span>
      </div>
      <span class="brand-preview__accents">${accents.map((a) => html`<span style="background: ${a};"></span>`) as unknown as SafeHtml[]}</span>
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
        <div class="brand-maker__previews">${brandPreview(p.effective, 'light')}${brandPreview(p.effective, 'dark')}</div>
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
      <h3 id="brand-maker-title" class="brand-maker__title">Update my brand</h3>
      <p class="brand-maker__lede">Give sua your website or describe the look, and it proposes colours for both modes, fonts, corners and tile accents. You see it before anything changes.</p>
      ${ask}
      ${body}
    </section>`;
}

/** The colour tokens the form offers (the rest stay editable in .sua/theme.json). */
const FORM_TOKENS: Array<[BrandColorToken, string]> = [
  ['primary', 'Accent'], ['bg', 'Page'], ['surface', 'Surface'], ['surface-raised', 'Raised surface'],
  ['border', 'Border'], ['text', 'Text'], ['text-muted', 'Muted text'],
  ['ok', 'Good'], ['warn', 'Warning'], ['err', 'Error'],
];

export function renderSettingsAppearance(opts: { a2uiWidgets?: boolean; boardPages?: boolean; brand?: BrandFormInput } = {}): SafeHtml {
  const brand = opts.brand;
  const presets = THEMES.filter((t) => t.id !== 'light');
  const cards = presets.map((t) => html`
      <label class="theme-card${brand?.theme.preset === t.id ? ' is-active' : ''}" title="${t.description}">
        <input type="radio" name="preset" value="${t.id}"${unsafeHtml(brand?.theme.preset === t.id ? ' checked' : '')} class="theme-card__radio">
        <div class="theme-card__preview" style="background: ${t.preview.bg};">
          <div style="background: ${t.preview.surface}; border-radius: 4px; padding: var(--space-2); margin-bottom: var(--space-1);">
            <div style="width: 40px; height: 4px; background: ${t.preview.accent}; border-radius: 2px; margin-bottom: 4px;"></div>
            <div style="width: 60px; height: 3px; background: ${t.preview.text}; border-radius: 2px; opacity: 0.5;"></div>
          </div>
          <div style="display: flex; gap: 4px;">
            <div style="flex: 1; background: ${t.preview.surface}; border-radius: 3px; height: 16px;"></div>
            <div style="flex: 1; background: ${t.preview.surface}; border-radius: 3px; height: 16px;"></div>
          </div>
        </div>
        <span class="theme-card__name">${t.name}</span>
      </label>`);
  const colorField = (mode: 'dark' | 'light', token: BrandColorToken, label: string) => {
    const own = brand?.theme[mode]?.[token] ?? '';
    const shown = brand?.effective[mode]?.[token] ?? '';
    return html`<label class="brand-field">
        <span class="brand-field__label">${label}</span>
        <span class="brand-field__row"><span class="brand-swatch" style="background: ${own || shown || `var(--color-${token})`};"></span>
        <input type="text" name="${mode}.${token}" value="${own}" placeholder="${shown || 'default'}" spellcheck="false" autocomplete="off"></span>
      </label>`;
  };
  const accentField = (name: string) => {
    const own = (brand?.theme.accents as Record<string, string | undefined> | undefined)?.[name] ?? '';
    const shown = (brand?.effective.accents as Record<string, string> | undefined)?.[name] ?? '';
    return html`<label class="brand-field">
        <span class="brand-field__label">${name}</span>
        <span class="brand-field__row"><span class="brand-swatch" style="background: ${own || shown};"></span>
        <input type="text" name="accents.${name}" value="${own}" placeholder="${shown}" spellcheck="false" autocomplete="off"></span>
      </label>`;
  };

  return html`
    <div>
      <h2 style="margin-top: 0; margin-bottom: var(--space-2);" id="brand">Brand</h2>
      <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-4);">
        One theme for the whole dashboard: every page, board and tile, in every browser. Start from a preset,
        then change any colour, the fonts, corner radius and tile accents. Leave a field empty to keep the preset's value.
        The light/dark switch in the top bar still picks the mode; set colours for each.
        See <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/brand.md">the brand guide</a>.
      </p>
      ${brand ? html`
      ${renderBrandMaker(brand)}
      ${renderSavedBrands(brand)}
      <h3 class="brands__title" style="margin: var(--space-6) 0 var(--space-3);">The look in use</h3>
      <form method="POST" action="/settings/appearance/brand" class="brand-form">
        <input type="hidden" name="version" value="${brand.version}">
        <div class="theme-grid">${cards as unknown as SafeHtml[]}</div>
        <label class="brand-field brand-field--wide"><span class="brand-field__label">Name</span>
          <input type="text" name="name" value="${brand.theme.name ?? ''}" placeholder="Your brand" maxlength="60"></label>
        <div class="brand-columns">
          <fieldset class="brand-fieldset"><legend>Dark mode colours</legend>${FORM_TOKENS.map(([t, l]) => colorField('dark', t, l)) as unknown as SafeHtml[]}</fieldset>
          <fieldset class="brand-fieldset"><legend>Light mode colours</legend>${FORM_TOKENS.map(([t, l]) => colorField('light', t, l)) as unknown as SafeHtml[]}</fieldset>
        </div>
        <fieldset class="brand-fieldset brand-fieldset--inline"><legend>Type and shape</legend>
          <label class="brand-field brand-field--wide"><span class="brand-field__label">Text font</span>
            <input type="text" name="fonts.sans" value="${brand.theme.fonts.sans ?? ''}" placeholder="${brand.effective.fonts.sans ?? 'system-ui, sans-serif'}" spellcheck="false"></label>
          <label class="brand-field brand-field--wide"><span class="brand-field__label">Code font</span>
            <input type="text" name="fonts.mono" value="${brand.theme.fonts.mono ?? ''}" placeholder="${brand.effective.fonts.mono ?? 'JetBrains Mono, monospace'}" spellcheck="false"></label>
          ${(['sm', 'md', 'lg'] as const).map((k) => html`<label class="brand-field"><span class="brand-field__label">Corner radius ${k} (px)</span>
            <input type="number" min="0" max="40" name="radius.${k}" value="${brand.theme.radius[k] !== undefined ? String(brand.theme.radius[k]) : ''}" placeholder="${brand.effective.radius[k] !== undefined ? String(brand.effective.radius[k]) : 'default'}"></label>`) as unknown as SafeHtml[]}
        </fieldset>
        <fieldset class="brand-fieldset brand-fieldset--inline"><legend>Tile accents</legend>
          ${(['teal', 'blue', 'green', 'orange', 'red', 'purple']).map(accentField) as unknown as SafeHtml[]}
        </fieldset>
        <p class="dim" style="font-size: var(--font-size-xs);">Colours: <code>#rrggbb</code>, <code>rgb(…)</code>, <code>rgba(…)</code>, <code>hsl(…)</code> or <code>transparent</code>. Fonts: family names separated by commas (fonts already on the viewer's computer).</p>
        <div style="display: flex; gap: var(--space-2); align-items: center;">
          <button type="submit" class="btn btn--primary btn--sm">Save brand</button>
          <button type="submit" class="btn btn--ghost btn--sm" name="reset" value="1">Reset to sua's default</button>
        </div>
      </form>
      ${brand.hasBackup ? html`<form method="POST" action="/settings/appearance/brand/undo" style="margin-top: var(--space-2);">
        <input type="hidden" name="version" value="${brand.version}">
        <button type="submit" class="btn btn--ghost btn--sm">Undo last change</button></form>` : html``}
      ${unsafeHtml(`<script>
        (function () {
          // This browser used one of the old per-browser widget themes: offer it as the brand.
          var old = null; try { old = localStorage.getItem('sua-widget-theme'); } catch (e) {}
          var form = document.querySelector('.brand-form');
          if (form && old && old !== 'default' && old !== 'light' && ${JSON.stringify(brand.theme.preset)} === 'default') {
            var p = document.createElement('p');
            p.className = 'flash flash--info';
            p.textContent = 'This browser used the "' + old + '" theme, which now lives here as a brand preset for everyone. Pick it above and save to keep it.';
            form.parentNode.insertBefore(p, form);
          }
          try { localStorage.removeItem('sua-widget-theme'); } catch (e) {}
          // Selecting a preset card marks it active.
          document.querySelectorAll('.theme-card__radio').forEach(function (r) {
            r.addEventListener('change', function () {
              document.querySelectorAll('.theme-card').forEach(function (c) { c.classList.remove('is-active'); });
              r.closest('.theme-card').classList.add('is-active');
            });
          });
        })();
      </script>`)}` : html``}
    </div>

    <section id="a2ui-widgets" style="margin-top: var(--space-6);">
      <h2 style="margin-top: 0; margin-bottom: var(--space-2);">Widget renderer</h2>
      <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-3);">
        Agents' widgets (Pulse templates and output widgets) are drawn with the
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/a2ui-views.md">A2UI renderer</a>,
        the one agent views use. If a widget looks wrong, untick this to switch back to the previous
        renderer for now (and tell us which agent): it stays one release as a fallback, then it's removed.
        Applies to everyone using this dashboard.
      </p>
      <form method="POST" action="/settings/appearance/a2ui" class="settings-pricing__form">
        <label class="settings-pricing__field" style="flex-direction: row; align-items: center; gap: var(--space-2);">
          <input type="checkbox" name="enabled" value="1" ${opts.a2uiWidgets ? 'checked' : ''}>
          <span>Draw widgets with A2UI</span>
        </label>
        <button type="submit" class="btn btn--sm">Save</button>
      </form>
    </section>

    <section id="board-pages" style="margin-top: var(--space-6);">
      <h2 style="margin-top: 0; margin-bottom: var(--space-2);">Pulse and dashboards</h2>
      <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-3);">
        Pulse and your dashboards are <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/boards.md">boards</a>:
        canvases you arrange with sections, tabs and grids, saved for every browser, and arrangeable by agents. Untick this to go back to
        the previous layout for now: it stays one release as a fallback, then it's removed. Applies to everyone using this dashboard.
      </p>
      <form method="POST" action="/settings/appearance/boards" class="settings-pricing__form">
        <label class="settings-pricing__field" style="flex-direction: row; align-items: center; gap: var(--space-2);">
          <input type="checkbox" name="enabled" value="1" ${opts.boardPages ? 'checked' : ''}>
          <span>Show Pulse and dashboards as boards</span>
        </label>
        <button type="submit" class="btn btn--sm">Save</button>
      </form>
    </section>

  `;
}
