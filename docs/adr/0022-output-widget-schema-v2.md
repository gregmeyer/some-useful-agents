# ADR-0022: Output widget schema extension for ai-template

## Status
Accepted

## Context
Adding the `ai-template` widget type (ADR-0020) required schema changes. The existing Zod schema had:

```ts
outputWidgetSchema = z.object({
  type: z.enum(['diff-apply', 'key-value', 'raw', 'dashboard']),
  fields: z.array(widgetFieldSchema).min(1),
  actions: z.array(widgetActionSchema).optional(),
});
```

`fields` was required and non-empty. An `ai-template` widget doesn't declare fields — it declares a `template` and extracts placeholders from it at render time. Two additions needed:

1. A `template` string field (the stored HTML) and a `prompt` string (the user's original description, preserved for iteration).
2. Making `fields` optional *only for* `ai-template`, so existing widget types still error on empty fields as a correctness guard.

## Decision
Extend the schema with optional `prompt` and `template` strings, make `fields` optional top-level, and add a `superRefine` that branches on widget type:

```ts
outputWidgetSchema = z.object({
  type: z.enum(['diff-apply', 'key-value', 'raw', 'dashboard', 'ai-template']),
  fields: z.array(widgetFieldSchema).optional(),
  actions: z.array(widgetActionSchema).optional(),
  prompt: z.string().optional(),
  template: z.string().optional(),
}).superRefine((schema, ctx) => {
  if (schema.type === 'ai-template') {
    if (!schema.template || schema.template.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'ai-template widgets need a non-empty template.' });
    }
  } else {
    if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Non-ai widgets need at least one field.' });
    }
  }
});
```

Mirror the change in the TypeScript interface so `fields?:` is optional and `prompt?: string` / `template?: string` exist. Runtime renderers in `output-widgets.ts` get guarded against the missing-fields case — they were iterating `schema.fields` directly; now they use `schema.fields ?? []`.

## Consequences
**Easier:** additive. No migration needed — existing widgets continue to validate because they have a non-empty `fields`. Existing YAML agents continue to parse. The new `ai-template` type validates under the new branch.

**Impact on the DB:** `outputWidget` is stored as JSON in the agents row; no DB schema change. Old rows rehydrate fine because `fields` is still read when present.

**Trade-off:** the shape `{ type, fields? }` is slightly less type-safe than a discriminated union per widget type would be. A discriminated union would ossify the data model (every new widget type needs a new variant), whereas the current `superRefine` lets renderers add their own per-type validation incrementally. We preferred flexibility.

**Not done here:** per-widget-type typed accessors (`schema.fields!` casts remain at a few call sites); validation of the stored `template` HTML (we just re-sanitize at render time — see ADR-0021).

## Alternatives considered
- **Discriminated union** with one object shape per widget type. Cleaner at the type level; more noise to extend. Revisit if the widget-type count grows to 10+.
- **Separate `aiTemplate` top-level field** on `OutputWidgetSchema` (not inside `fields`). Rejected — makes the "which widget is this?" ambiguous; a single `type` discriminator is clearer for downstream code.
