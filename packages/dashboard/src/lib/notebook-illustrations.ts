/**
 * Illustrations for notebook options with no photo: drawn here, not by a
 * model (a model's SVG was a box with two circles). Each is a clean, flat
 * picture of what the option is (a car, a bike, a guitar, a laptop, a home,
 * a company's monogram for a job), tinted per option so a shortlist of
 * similar things still tells them apart. Served as an image like any photo.
 */

export type IllustrationKind = 'car' | 'bike' | 'music' | 'laptop' | 'home' | 'job' | 'thing';

/** What an option is, from its notebook's words and its own name. */
export function illustrationKind(notebook: { title: string; statement: string }, optionName: string): IllustrationKind {
  const s = `${notebook.title} ${notebook.statement} ${optionName}`.toLowerCase();
  if (/\b(car|suv|truck|vehicle|sedan|wagon|hatchback|rav4|forester|crv|cr-v|outback|civic|corolla|camry|subaru|toyota|honda|mazda)\b/.test(s)) return 'car';
  if (/\b(job|role|career|engineer|hiring|position|manager|designer|developer)\b/.test(s)) return 'job';
  // Companies to research or qualify (accounts, vendors, leads) get the same monogram tile.
  if (/\b(compan(y|ies)|accounts?|vendors?|startups?|b2b|saas|leads?|prospects?|customers?)\b/.test(s)) return 'job';
  if (/\b(bike|bicycle|cycling)\b/.test(s)) return 'bike';
  if (/\b(guitar|piano|keyboard|instrument|bass|ukulele|synth)\b/.test(s)) return 'music';
  if (/\b(laptop|computer|macbook|notebook pc|thinkpad)\b/.test(s)) return 'laptop';
  if (/\b(house|home|apartment|flat|condo|rent)\b/.test(s)) return 'home';
  return 'thing';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A stable hue for an option, from its id. */
function hueOf(seed: string): number {
  let h = 7;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** A job's company monogram: the company after a comma, else the first word. */
function monogram(name: string): string {
  const company = name.includes(',') ? name.split(',').pop()!.trim() : name.trim();
  const words = company.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?')[0]).toUpperCase();
}

function drawing(kind: IllustrationKind, body: string, dark: string, light: string, name: string): string {
  switch (kind) {
    case 'car': return `
      <ellipse cx="160" cy="188" rx="128" ry="10" fill="#000" fill-opacity="0.12"/>
      <path d="M38 166 L44 138 Q48 124 64 120 L104 114 L134 84 Q142 76 154 76 L226 76 Q240 76 248 86 L270 114 L286 118 Q300 122 302 138 L302 166 Q302 172 296 172 L44 172 Q38 172 38 166 Z" fill="${body}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M140 90 Q146 86 154 86 L184 86 L184 114 L116 114 Z" fill="${light}" stroke="${dark}" stroke-width="2"/>
      <path d="M194 86 L224 86 Q234 86 240 94 L256 114 L194 114 Z" fill="${light}" stroke="${dark}" stroke-width="2"/>
      <path d="M190 116 L190 166" stroke="${dark}" stroke-opacity="0.35" stroke-width="2"/>
      <path d="M44 140 L300 140" stroke="#fff" stroke-opacity="0.25" stroke-width="3"/>
      <rect x="286" y="128" width="12" height="8" rx="2" fill="#fde68a"/>
      <rect x="40" y="130" width="10" height="8" rx="2" fill="#fca5a5"/>
      <circle cx="94" cy="172" r="24" fill="#1f2937"/><circle cx="94" cy="172" r="11" fill="#cbd5e1"/><circle cx="94" cy="172" r="4" fill="#64748b"/>
      <circle cx="246" cy="172" r="24" fill="#1f2937"/><circle cx="246" cy="172" r="11" fill="#cbd5e1"/><circle cx="246" cy="172" r="4" fill="#64748b"/>`;
    case 'bike': return `
      <ellipse cx="160" cy="188" rx="120" ry="8" fill="#000" fill-opacity="0.1"/>
      <circle cx="90" cy="150" r="40" fill="none" stroke="#1f2937" stroke-width="6"/><circle cx="230" cy="150" r="40" fill="none" stroke="#1f2937" stroke-width="6"/>
      <circle cx="90" cy="150" r="4" fill="#1f2937"/><circle cx="230" cy="150" r="4" fill="#1f2937"/>
      <path d="M90 150 L140 150 L190 92 L124 92 Z M140 150 L118 80 M190 92 L230 150 M190 92 L184 70 L206 66" fill="none" stroke="${body}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M104 78 L134 78" stroke="#1f2937" stroke-width="7" stroke-linecap="round"/>
      <circle cx="140" cy="150" r="10" fill="none" stroke="${dark}" stroke-width="4"/>`;
    case 'music': return `
      <ellipse cx="160" cy="196" rx="70" ry="8" fill="#000" fill-opacity="0.1"/>
      <rect x="152" y="18" width="16" height="104" rx="4" fill="#78350f"/>
      <rect x="146" y="10" width="28" height="22" rx="5" fill="#451a03"/>
      <path d="M160 110 C 120 108, 110 140, 124 158 C 96 170, 104 200, 160 200 C 216 200, 224 170, 196 158 C 210 140, 200 108, 160 110 Z" fill="${body}" stroke="${dark}" stroke-width="3"/>
      <circle cx="160" cy="150" r="14" fill="#1f2937"/>
      <rect x="146" y="176" width="28" height="6" rx="2" fill="#451a03"/>
      <path d="M156 32 V176 M164 32 V176" stroke="#e5e7eb" stroke-width="1"/>`;
    case 'laptop': return `
      <ellipse cx="160" cy="190" rx="124" ry="8" fill="#000" fill-opacity="0.1"/>
      <rect x="70" y="48" width="180" height="116" rx="8" fill="#1f2937"/>
      <rect x="80" y="58" width="160" height="96" rx="3" fill="${light}"/>
      <path d="M80 130 L130 96 L160 116 L200 82 L240 112 L240 154 L80 154 Z" fill="${body}" fill-opacity="0.85"/>
      <path d="M40 168 L280 168 L268 182 Q266 186 260 186 L60 186 Q54 186 52 182 Z" fill="#9ca3af" stroke="#4b5563" stroke-width="2"/>`;
    case 'home': return `
      <ellipse cx="160" cy="192" rx="110" ry="8" fill="#000" fill-opacity="0.1"/>
      <path d="M72 104 L160 40 L248 104" fill="none" stroke="${dark}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
      <rect x="88" y="100" width="144" height="88" fill="${body}" stroke="${dark}" stroke-width="3"/>
      <rect x="146" y="134" width="28" height="54" rx="2" fill="${dark}"/>
      <rect x="104" y="118" width="28" height="24" rx="2" fill="${light}"/><rect x="188" y="118" width="28" height="24" rx="2" fill="${light}"/>`;
    case 'job': return `
      <rect x="100" y="40" width="120" height="120" rx="28" fill="${body}" stroke="${dark}" stroke-width="3"/>
      <text x="160" y="118" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="56" font-weight="700" fill="#fff">${esc(monogram(name))}</text>`;
    default: return `
      <ellipse cx="160" cy="190" rx="90" ry="8" fill="#000" fill-opacity="0.1"/>
      <path d="M100 80 L160 50 L220 80 L220 160 L160 190 L100 160 Z" fill="${body}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M100 80 L160 110 L220 80 M160 110 L160 190" fill="none" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M130 65 L190 95" stroke="${light}" stroke-width="10" stroke-linecap="round"/>`;
  }
}

/** A clean picture of what an option is, as SVG text (no script, no external refs). */
export function optionIllustration(args: { kind: IllustrationKind; name: string; seed: string }): string {
  const h = hueOf(args.seed);
  const body = `hsl(${String(h)} 52% 52%)`;
  const dark = `hsl(${String(h)} 45% 28%)`;
  const light = `hsl(${String(h)} 60% 88%)`;
  const label = args.name.length > 34 ? `${args.name.slice(0, 33)}…` : args.name;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="${esc(`An illustration of ${args.name}`)}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${String(h)} 60% 96%)"/><stop offset="1" stop-color="hsl(${String(h)} 40% 88%)"/></linearGradient></defs>
    <rect width="320" height="240" fill="url(#bg)"/>
    ${drawing(args.kind, body, dark, light, args.name)}
    <text x="160" y="226" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" fill="${dark}">${esc(label)}</text>
  </svg>`;
}
