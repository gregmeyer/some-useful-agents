/**
 * The concatenated client-side JS bundle, served ONCE as an external cached
 * asset (`/assets/dashboard.js`) instead of being inlined into every page's
 * HTML. Inlining meant the browser re-parsed + re-compiled ~370KB of JS on
 * every full-page navigation (the CSS was already external/cached; the JS was
 * not) — the dominant per-navigation cost. As an external file with an ETag,
 * the browser parses it once, code-caches it, and 304s on subsequent loads.
 *
 * The concatenation ORDER is execution order — keep it identical to the former
 * inline order in layout.ts. Add new bundles here (not in the layout template).
 */
import { DASHBOARD_JS } from './js.js';
import { TEMPLATE_PALETTE_JS } from './template-palette.js.js';
import { SUGGEST_IMPROVEMENTS_JS } from './suggest-improvements.js.js';
import { PULSE_LAYOUT_JS } from './pulse-layout.js.js';
import { PULSE_MASONRY_JS } from './pulse-masonry.js.js';
import { HOME_LAYOUT_JS } from './home-layout.js.js';
import { DASHBOARDS_LAYOUT_JS } from './dashboards-layout.js.js';
import { BUILD_FROM_GOAL_JS } from './build-from-goal.js.js';
import { IMPROVE_LAYOUT_JS } from './improve-layout.js.js';
import { OUTPUT_WIDGET_ACTIONS_JS } from './output-widget-actions.js.js';
import { RUN_DETAIL_FILTER_JS } from './run-detail-filter.js.js';
import { PULSE_CONFIGURE_JS } from './pulse-configure.js.js';
import { PULSE_REFRESH_JS } from './pulse-refresh.js.js';
import { WIDGET_REPLAY_INPLACE_JS } from './widget-replay.js.js';
import { WIDGET_COPY_JS } from './widget-copy.js.js';
import { WIDGET_CAPTURE_JS } from './widget-capture.js.js';
import { PAGE_INTRO_JS } from './page-intro.js.js';
import { ADD_TILE_MODAL_JS } from './add-tile-modal.js.js';
import { CSP_ALLOW_JS } from './csp-allow.js.js';
import { CSP_IMG_REPORT_JS } from './csp-img-report.js.js';
import { WIDGET_IMG_FALLBACK_JS } from './widget-img-fallback.js.js';
import { INSTALL_PACKS_MODAL_JS } from './install-packs-modal.js.js';
import { INBOX_MODAL_JS } from './inbox-modal.js.js';
import { INBOX_BADGE_JS } from './inbox-badge.js.js';
import { INBOX_STREAM_JS } from './inbox-stream.js.js';
import { INBOX_LIST_JS } from './inbox-list.js.js';
import { HOME_INBOX_JS } from './home-inbox.js.js';
import { ALLOWED_SUB_AGENTS_PICKLIST_JS } from './allowed-sub-agents-picklist.js.js';
import { NODE_DISCOVERY_JS } from './node-discovery.js.js';
import { APP_ASK_JS } from './app-ask.js.js';

export const CLIENT_BUNDLE_JS: string =
  DASHBOARD_JS + TEMPLATE_PALETTE_JS + SUGGEST_IMPROVEMENTS_JS + PULSE_LAYOUT_JS
  + PULSE_MASONRY_JS + HOME_LAYOUT_JS + DASHBOARDS_LAYOUT_JS + BUILD_FROM_GOAL_JS
  + IMPROVE_LAYOUT_JS + OUTPUT_WIDGET_ACTIONS_JS + RUN_DETAIL_FILTER_JS + PULSE_CONFIGURE_JS
  + PULSE_REFRESH_JS + WIDGET_REPLAY_INPLACE_JS + WIDGET_COPY_JS + WIDGET_CAPTURE_JS
  + PAGE_INTRO_JS + ADD_TILE_MODAL_JS + CSP_ALLOW_JS + CSP_IMG_REPORT_JS
  + WIDGET_IMG_FALLBACK_JS + INSTALL_PACKS_MODAL_JS + INBOX_MODAL_JS + INBOX_BADGE_JS
  + INBOX_STREAM_JS + INBOX_LIST_JS + HOME_INBOX_JS + ALLOWED_SUB_AGENTS_PICKLIST_JS
  + NODE_DISCOVERY_JS + APP_ASK_JS;
