/** A notebook fact as the page shows it: money as $12,500 (or $1.2M), a range once with its unit, years without separators. Pure. */
import { isRange, type NotebookField, type NotebookFieldValue } from '@some-useful-agents/core';

/** Money: "$4,023", "$150,000"; a million and up "$18M", "$2.5B" (a company's revenue). */
export function formatMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
  if (a >= 1e6) return `$${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** "$4,023", "149,652 mi", "2010": one field's value as people read it. */
export function formatFieldValue(f: NotebookField, v: NotebookFieldValue): string {
  if (isRange(v)) {
    if (v.min === v.max) return formatFieldValue(f, v.min);
    // "$150,000–$180,000", "120–150 sq ft": the unit once, at the end.
    const one = (n: number) => (f.type === 'money' ? formatMoney(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    return `${one(v.min)}–${one(v.max)}${f.unit && f.type !== 'money' ? ` ${f.unit}` : ''}`;
  }
  if (typeof v === 'number') {
    const n = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (f.type === 'money') return formatMoney(v);
    // Years and ids read without separators.
    if (f.type === 'number' && !f.unit && Number.isInteger(v) && v >= 1900 && v <= 2100) return String(v);
    return f.unit ? `${n} ${f.unit}` : n;
  }
  return v;
}
