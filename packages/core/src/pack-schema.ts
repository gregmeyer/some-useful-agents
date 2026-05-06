/**
 * Zod schema for the widget pack manifest YAML format.
 *
 * Packs ship as YAML files in `packages/core/packs/<id>.yaml` (built-in)
 * or anywhere a user wants to author one (user/exported). The loader
 * validates the YAML against this schema before registering.
 *
 * Two forms accepted for agent refs:
 *  - `yaml: "<inline string>"` — full YAML embedded in the manifest
 *  - `yamlPath: "relative/path/to/agent.yaml"` — resolved by the loader
 *    against the manifest file's directory; the file is read and inlined
 *    into `yaml` before the manifest is stored. Either form, never both.
 */

import { z } from 'zod';

const PACK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DASHBOARD_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const sectionSchema = z.object({
  title: z.string().min(1),
  agentIds: z.array(z.string().min(1)).min(1, 'A section must list at least one agent.'),
});

const dashboardSchema = z.object({
  id: z.string().regex(DASHBOARD_ID_RE, 'Dashboard ids: lowercase letters/digits/hyphens, starting alnum.'),
  name: z.string().min(1),
  sections: z.array(sectionSchema).min(1, 'A dashboard needs at least one section.'),
});

const agentRefSchema = z.object({
  id: z.string().min(1),
  yaml: z.string().min(1).optional(),
  yamlPath: z.string().min(1).optional(),
}).refine(
  (a) => !(a.yaml && a.yamlPath),
  { message: 'Specify either yaml or yamlPath, not both.' },
);

export const packManifestSchema = z.object({
  id: z.string().regex(PACK_ID_RE, 'Pack ids: lowercase letters/digits/hyphens, starting alnum.'),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().regex(SEMVER_RE, 'version must be semver (e.g. 0.1.0).'),
  author: z.string().optional(),
  agents: z.array(agentRefSchema).optional(),
  dashboards: z.array(dashboardSchema).optional(),
}).refine(
  (m) => (m.agents?.length ?? 0) > 0 || (m.dashboards?.length ?? 0) > 0,
  { message: 'A pack must contribute at least one agent or one dashboard.' },
);

export type PackManifestInput = z.input<typeof packManifestSchema>;
export type PackManifestParsed = z.output<typeof packManifestSchema>;
