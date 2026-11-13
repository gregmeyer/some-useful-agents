/** Tests only: builds a small real PDF. */

/** A small real PDF: one page per entry, each line of it drawn as text. */
export function makePdf(pages: string[][]): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${String(4 + i * 2)} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const stream = lines.length ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join(' ')} ET` : '';
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(5 + i * 2)} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const at: number[] = [];
  for (let n = 1; n < objs.length; n++) { at[n] = out.length; out += `${String(n)} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${String(objs.length)}\n0000000000 65535 f \n${at.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${String(objs.length)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
