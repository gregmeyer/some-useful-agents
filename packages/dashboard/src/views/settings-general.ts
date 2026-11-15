import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsGeneralArgs {
  /** First 8 hex chars of the current MCP token. Full value never rendered. */
  tokenFingerprint: string;
  /** Absolute paths shown so users know where sua reads + writes. */
  tokenPath: string;
  secretsPath: string;
  dbPath: string;
  /** Full MCP token to reveal exactly once, right after rotation. */
  rotatedToken?: string;
  retentionDays: number;
  /** The kinds of file sua can read, and which are allowed now. */
  fileTypes: ReadonlyArray<{ ext: string; label: string; on: boolean }>;
}

/**
 * Render the `/settings/general` body.
 *
 * Tables stopped being a good fit once the "freshly rotated token"
 * card needs a one-off reveal block — kept each setting as its own
 * card so the rotate flow has a natural place to surface the new
 * value without interrupting the list layout.
 */
export function renderSettingsGeneral(args: SettingsGeneralArgs): SafeHtml {
  return html`
    <div class="card">
      <p class="card__title">MCP bearer token</p>
      <p class="dim">
        The dashboard shares this token with the MCP server at
        <code>${args.tokenPath}</code>. Rotating it generates a fresh
        secret, invalidates existing MCP client configs, and resets
        this dashboard's session cookie to the new value.
      </p>
      <dl class="kv mt-3">
        <dt>Fingerprint</dt>
        <dd class="mono">${args.tokenFingerprint}…</dd>
        <dt>Path</dt>
        <dd class="mono">${args.tokenPath}</dd>
      </dl>
      ${renderRotatedBanner(args.rotatedToken)}
      <form action="/settings/general/rotate-mcp-token" method="post" class="mt-3"
        data-confirm="Rotate the MCP bearer token? Existing Claude Desktop / MCP client configs will stop working until you update them.">
        <button type="submit" class="btn btn--warn">Rotate token</button>
      </form>
    </div>

    <div class="card" id="files">
      <p class="card__title">Files sua takes</p>
      <p class="dim">
        Where you'd otherwise paste (a notebook's Add a file or paste, the
        paperclip on a message), sua takes these kinds of file. It reads the
        text out of the file and keeps only that; the file itself is not kept.
        Untick them all and only pasting is left.
      </p>
      <form action="/settings/general/file-types" method="post" class="mt-3">
        ${args.fileTypes.map((t) => html`<label style="display: block; margin-bottom: var(--space-2);"><input type="checkbox" name="types" value="${t.ext}"${t.on ? unsafeHtml(' checked') : unsafeHtml('')}> ${t.label}</label>`) as unknown as SafeHtml[]}
        <p class="dim">Pictures (.jpg, .png, .gif), scanned PDFs and older Word files (.doc) can't be read yet.</p>
        <button type="submit" class="btn">Save</button>
      </form>
    </div>

    <div class="card">
      <p class="card__title">Retention</p>
      <p>Run history older than <strong>${args.retentionDays}</strong> day${args.retentionDays === 1 ? '' : 's'} is deleted at process startup.</p>
      <p class="dim">
        Edit <code>sua.config.json</code> (<code>runRetentionDays</code>)
        to change this. In-UI editing is queued for a later release.
      </p>
    </div>

    <div class="card">
      <p class="card__title">Paths</p>
      <dl class="kv">
        <dt>Run database</dt>
        <dd class="mono">${args.dbPath}</dd>
        <dt>Secrets file</dt>
        <dd class="mono">${args.secretsPath}</dd>
        <dt>MCP token</dt>
        <dd class="mono">${args.tokenPath}</dd>
      </dl>
    </div>
  `;
}

function renderRotatedBanner(token: string | undefined): SafeHtml {
  if (!token) return unsafeHtml('');
  return html`
    <div class="flash flash--ok mt-3">
      <p class="mb-2 mt-0"><strong>New token:</strong></p>
      <p class="mono mt-0 mb-0" style="word-break: break-all;">${token}</p>
      <p class="dim mb-0" style="margin-top: var(--space-2);">
        Copy it now — this is the only time it will be displayed.
        Update your MCP client config and restart any <code>sua mcp start</code>.
      </p>
    </div>
  `;
}
