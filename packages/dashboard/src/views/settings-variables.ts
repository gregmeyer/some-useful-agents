import type { Variable } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsVariablesArgs {
  /** All variables, sorted by name. */
  variables: Array<[string, Variable]>;
  /** Inline error from a failed set/delete. */
  setError?: string;
  /** Preserve form values on round-trip. */
  setNameValue?: string;
  setValueValue?: string;
  setDescriptionValue?: string;
}

/**
 * Render the `/settings/variables` body. Variables are plain-text,
 * non-sensitive values visible to every agent at run time. Unlike
 * secrets, values ARE shown (they're not sensitive). CRUD parallels
 * the secrets tab but without the unlock/lock ceremony.
 */
export function renderSettingsVariables(args: SettingsVariablesArgs): SafeHtml {
  return html`
    <div class="card">
      <p class="card__title">Global variables</p>
      <p class="dim">
        Plain-text values available to every agent. Reference as
        <code>$NAME</code> in shell commands or <code>{{vars.NAME}}</code>
        in claude-code prompts. For sensitive values, use
        <a href="/settings/secrets">Secrets</a> instead.
      </p>
      ${renderVariablesTable(args.variables)}
    </div>

    <div class="card">
      <p class="card__title">Set a variable</p>
      <p class="dim">
        Names must be uppercase letters, digits, or underscores and start
        with a letter or underscore (e.g. <code>API_BASE_URL</code>).
        Setting an existing name overwrites its value.
      </p>
      ${setErrorBlock(args.setError)}
      <form action="/settings/variables/set" method="post" class="settings-form">
        <label class="settings-form__label" for="var-name">Name</label>
        <input id="var-name" name="name" type="text" required
          pattern="[A-Z_][A-Z0-9_]*"
          placeholder="API_BASE_URL"
          value="${args.setNameValue ?? ''}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <label class="settings-form__label" for="var-value">Value</label>
        <input id="var-value" name="value" type="text" required
          placeholder="https://api.example.com"
          value="${args.setValueValue ?? ''}"
          autocomplete="off">

        <label class="settings-form__label" for="var-description">Description (optional)</label>
        <input id="var-description" name="description" type="text"
          placeholder="Shared API base URL"
          value="${args.setDescriptionValue ?? ''}">

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Save variable</button>
        </div>
      </form>
    </div>
  `;
}

function renderVariablesTable(variables: Array<[string, Variable]>): SafeHtml {
  if (variables.length === 0) {
    return html`<p class="settings-empty mt-3">No variables set yet. Add one below.</p>`;
  }
  const rows = variables.map(([name, v]) => html`
    <tr>
      <td class="mono">${name}</td>
      <td class="mono">${v.value}</td>
      <td class="dim">${v.description ?? ''}</td>
      <td class="text-right">
        <form action="/settings/variables/delete" method="post"
          data-confirm="Delete variable ${name}? Agents that reference it will get an empty value.">
          <input type="hidden" name="name" value="${name}">
          <button type="submit" class="btn btn--sm btn--ghost">Delete</button>
        </form>
      </td>
    </tr>
  `);
  return html`
    <table class="table mt-3">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>Description</th>
          <th class="text-right">Action</th>
        </tr>
      </thead>
      <tbody>${rows as unknown as SafeHtml[]}</tbody>
    </table>
  `;
}

function setErrorBlock(err: string | undefined): SafeHtml {
  if (!err) return unsafeHtml('');
  return html`<div class="flash flash--error mb-3">${err}</div>`;
}
