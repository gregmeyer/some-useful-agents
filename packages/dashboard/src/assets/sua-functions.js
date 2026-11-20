// sua's A2UI functions (ADR-0087): small, pure calculations a view, a notebook
// page or a form's message makes in the browser, with no round trip. Each is
// an A2UI 1.0 function implementation: its name, what it returns, its args
// (zod, built from the vendored renderer's own z and common schemas), and
// what it does with them, already resolved. The server validates the same
// names and args (packages/core/src/a2ui/catalog.ts, SUA_FUNCTION_ARGS); a
// test keeps the two in step.

/** "hotel, rental", or with `last`: "hotel, rental and villa". */
export function joinWords(list, separator = ', ', last) {
  const xs = (Array.isArray(list) ? list : list === undefined || list === null || list === '' ? [] : [list]).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
  if (last && xs.length > 1) return `${xs.slice(0, -1).join(separator)}${last}${xs[xs.length - 1]}`;
  return xs.join(separator);
}

/** "3 days ago", "in 2 hours", "just now" (from `now`, a time in ms). */
export function relativeWords(iso, now = Date.now()) {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const s = Math.round((t - now) / 1000);
  if (Math.abs(s) < 45) return 'just now';
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(s) >= size) return fmt.format(Math.round(s / size), unit);
  return fmt.format(Math.round(s / 60), 'minute');
}

/** "$120K–$140K" (money, short), "120–140" (numbers); one end when the other's missing or they're equal. */
export function rangeWords(min, max, currency) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const lo = n(min), hi = n(max);
  const one = (v) => {
    if (!currency) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const short = Math.abs(v) >= 1000;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...(short ? { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 } : { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }).format(v);
  };
  if (lo === undefined && hi === undefined) return '';
  if (lo === undefined || hi === undefined || lo === hi) return one(lo ?? hi);
  return `${one(lo)}–${one(hi)}`;
}

/** The functions, for a catalog built with this renderer's z and common schemas. */
export function suaFunctions(z, CommonSchemas) {
  const CS = CommonSchemas;
  const fn = (name, returnType, description, args, execute) => ({ name, returnType, description, allowedCallers: 'rendererOnly', schema: z.object(args).strict(), execute });
  return [
    fn('join', 'string', 'A list as words: "hotel, rental" (separator ", " unless given; last, e.g. " and ", before the last item).',
      { value: CS.DynamicValue, separator: z.string().optional(), last: z.string().optional() },
      (a) => joinWords(a.value, a.separator ?? ', ', a.last)),
    fn('relativeTime', 'string', 'A date or time as how long ago or until: "3 days ago", "in 2 hours".',
      { value: CS.DynamicString },
      (a) => relativeWords(a.value)),
    fn('formatRange', 'string', 'Two numbers as a range: "$120K–$140K" with a currency code, "120–140" without; one end when they match or one is missing.',
      { min: CS.DynamicValue, max: CS.DynamicValue, currency: z.string().optional() },
      (a) => rangeWords(a.min, a.max, a.currency)),
    fn('count', 'number', 'How many items a list has (0 when it has none or isn\'t a list).',
      { value: CS.DynamicValue },
      (a) => (Array.isArray(a.value) ? a.value.length : 0)),
  ];
}

/**
 * sua's agent functions (ADR-0088), declared with no implementation: the
 * A2UI 1.0 renderer sends each call to the dashboard (callAgentFunction,
 * through the page's outbound listener) and draws the answer when it comes.
 */
export function suaAgentFunctions(z, CommonSchemas) {
  const CS = CommonSchemas;
  const fn = (name, returnType, description, args) => ({ name, returnType, description, allowedCallers: 'rendererOnly', schema: z.object(args).strict() });
  return [
    fn('findOptions', 'array', "The notebook's options in the running whose name or facts have every word of q, best first, as rows for a Table.", { q: CS.DynamicString, limit: CS.DynamicValue.optional() }),
    fn('optionFacts', 'array', "One option's facts as {label, value} rows for a KeyValue.", { id: CS.DynamicString }),
  ];
}

