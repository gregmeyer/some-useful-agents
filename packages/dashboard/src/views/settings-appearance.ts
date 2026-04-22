/**
 * Settings > Appearance: theme picker grid.
 */

import { html, unsafeHtml, type SafeHtml } from './html.js';
import { THEMES } from './themes.js';

export function renderSettingsAppearance(): SafeHtml {
  const cards = THEMES.map((t) => {
    return html`
      <button type="button" class="theme-card" data-theme-id="${t.id}" title="${t.description}">
        <div class="theme-card__preview" style="background: ${t.preview.bg};">
          <div style="background: ${t.preview.surface}; border-radius: 4px; padding: 6px 8px; margin-bottom: 4px;">
            <div style="width: 40px; height: 4px; background: ${t.preview.accent}; border-radius: 2px; margin-bottom: 4px;"></div>
            <div style="width: 60px; height: 3px; background: ${t.preview.text}; border-radius: 2px; opacity: 0.5;"></div>
          </div>
          <div style="display: flex; gap: 4px;">
            <div style="flex: 1; background: ${t.preview.surface}; border-radius: 3px; height: 16px;"></div>
            <div style="flex: 1; background: ${t.preview.surface}; border-radius: 3px; height: 16px;"></div>
          </div>
        </div>
        <span class="theme-card__name">${t.name}</span>
      </button>
    `;
  });

  return html`
    <div>
      <h2 style="margin-top: 0; margin-bottom: var(--space-2);">Theme</h2>
      <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-4);">
        Choose a visual theme for the dashboard. Applies to all widget surfaces (Pulse, Home).
        Stored in your browser.
      </p>

      <div class="theme-grid">
        ${cards as unknown as SafeHtml[]}
      </div>

      <p style="font-size: var(--font-size-xs); color: var(--color-text-subtle); margin-top: var(--space-4);">
        The light/dark toggle in the top bar is separate from widget themes.
        Widget themes override widget colors only.
      </p>
    </div>

    ${unsafeHtml(`<script>
      (function () {
        var THEME_KEY = 'sua-widget-theme';
        var current = localStorage.getItem(THEME_KEY) || 'default';

        // Mark the active card.
        var cards = document.querySelectorAll('.theme-card');
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].getAttribute('data-theme-id') === current) {
            cards[i].classList.add('is-active');
          }
          cards[i].addEventListener('click', function () {
            var id = this.getAttribute('data-theme-id');
            // Store theme.
            if (id === 'default') {
              localStorage.removeItem(THEME_KEY);
              document.body.removeAttribute('data-widget-theme');
            } else if (id === 'light') {
              // Light theme uses the existing data-theme="light" system.
              localStorage.setItem(THEME_KEY, 'light');
              document.documentElement.setAttribute('data-theme', 'light');
              localStorage.setItem('sua-theme', 'light');
              document.body.removeAttribute('data-widget-theme');
            } else {
              localStorage.setItem(THEME_KEY, id);
              document.body.setAttribute('data-widget-theme', id);
              // Revert to dark base for non-light themes.
              document.documentElement.removeAttribute('data-theme');
              localStorage.setItem('sua-theme', 'dark');
            }
            // Update active state.
            var all = document.querySelectorAll('.theme-card');
            for (var j = 0; j < all.length; j++) all[j].classList.remove('is-active');
            this.classList.add('is-active');
          });
        }
      })();
    </script>`)}
  `;
}
