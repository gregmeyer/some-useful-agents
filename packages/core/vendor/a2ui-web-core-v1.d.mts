// Types for the vendored A2UI web_core (protocol v1.0, ADR-0084): see
// packages/dashboard/scripts/vendor-a2ui.mjs. Loose on purpose: the schemas
// are zod (v3) objects checked at runtime by the A2UI processor, and their
// full types overflow TypeScript ("excessively deep").
/* eslint-disable @typescript-eslint/no-explicit-any */
export declare class Catalog<T = any> {
  constructor(id: string, version: string, components: readonly any[], functions?: readonly any[], options?: any);
  readonly id: string;
  readonly components: Map<string, T>;
  readonly functions: Map<string, any>;
}
export declare class MessageProcessor<T = any> {
  constructor(catalogs: readonly Catalog<T>[], onAction?: (action: any) => void, options?: any);
  processMessages(messages: readonly unknown[]): void;
  readonly model: any;
}
export declare const STRICT_VALIDATION: any;
export declare const CommonSchemas: any;
export declare const basicCatalog: Catalog;
export declare const BASIC_FUNCTIONS: readonly any[];
export declare const z: any;
export declare const A2UI_VENDORED: { version: string; commit: string };
