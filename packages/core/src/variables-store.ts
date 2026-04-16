import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Global variables store. Plain-text JSON file at `.sua/variables.json`.
 * Variables are non-sensitive project-wide values (API_BASE_URL, REGION,
 * DEFAULT_TIMEOUT) available to every agent at run time.
 *
 * NOT encrypted — if a value is sensitive, it belongs in the secrets
 * store. The `sua doctor` check flags names that look like secrets
 * (TOKEN, KEY, PASS, SECRET) so users can move them.
 */

export interface Variable {
  value: string;
  description?: string;
}

interface VariablesFile {
  version: 1;
  variables: Record<string, Variable>;
}

export class VariablesStore {
  private readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  get(name: string): Variable | undefined {
    return this.read().variables[name];
  }

  getValue(name: string): string | undefined {
    return this.read().variables[name]?.value;
  }

  set(name: string, value: string, description?: string): void {
    const data = this.read();
    data.variables[name] = { value, ...(description ? { description } : {}) };
    this.write(data);
  }

  delete(name: string): boolean {
    const data = this.read();
    if (!(name in data.variables)) return false;
    delete data.variables[name];
    this.write(data);
    return true;
  }

  list(): Record<string, Variable> {
    return { ...this.read().variables };
  }

  listNames(): string[] {
    return Object.keys(this.read().variables).sort();
  }

  has(name: string): boolean {
    return name in this.read().variables;
  }

  /** All values as a flat name→value map (for executor injection). */
  getAll(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.read().variables)) {
      out[k] = v.value;
    }
    return out;
  }

  private read(): VariablesFile {
    if (!existsSync(this.path)) {
      return { version: 1, variables: {} };
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as VariablesFile;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported variables file version: ${parsed.version}`);
      }
      return parsed;
    } catch (err) {
      if ((err as Error).message.includes('version')) throw err;
      return { version: 1, variables: {} };
    }
  }

  private write(data: VariablesFile): void {
    writeFileSync(this.path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}

/** Names that look like they should be secrets, not plain variables. */
const SENSITIVE_PATTERNS = [/TOKEN/i, /KEY/i, /PASS/i, /SECRET/i, /PASSWORD/i, /CREDENTIAL/i];

/** Check if a variable name looks sensitive (for `sua doctor` warnings). */
export function looksLikeSensitive(name: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(name));
}
