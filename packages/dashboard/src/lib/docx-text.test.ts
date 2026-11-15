import { describe, it, expect } from 'vitest';
import { docxText, docxXmlText } from './docx-text.js';
import { makeZip } from './docx-test-zip.js';

const DOC = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>Dana Reyes</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Chief Operating Officer, </w:t></w:r><w:r><w:t>Acme &amp; Sons</w:t></w:r></w:p>
<w:p><w:r><w:t>2019</w:t><w:tab/><w:t>Present</w:t><w:br/><w:t>Austin &#8212; Texas</w:t></w:r></w:p>
<w:p></w:p></w:body></w:document>`;

describe('the text of a Word file', () => {
  it('reads the document\'s paragraphs in order, a line each, with tabs, breaks and entities', () => {
    expect(docxXmlText(DOC)).toEqual({ text: 'Dana Reyes\nChief Operating Officer, Acme & Sons\n2019\tPresent\nAustin — Texas', paragraphs: 4 });
  });

  it('finds the document inside the zip, deflated or stored, among other entries', () => {
    const other = { name: '[Content_Types].xml', data: '<Types/>' };
    for (const stored of [false, true]) {
      const out = docxText(makeZip([other, { name: 'word/document.xml', data: DOC, stored }, { name: 'word/styles.xml', data: '<w:styles/>' }]));
      expect(out).toMatchObject({ text: expect.stringContaining('Chief Operating Officer, Acme & Sons'), paragraphs: 4 });
    }
  });

  it('says why when there is nothing to read, and never throws', () => {
    expect(docxText(new Uint8Array())).toEqual({ error: 'That file is empty.' });
    expect(docxText(Buffer.from('\xd0\xcf\x11\xe0 an old .doc file, not a zip at all, padded out', 'latin1'))).toMatchObject({ error: expect.stringContaining('older .doc') });
    expect(docxText(makeZip([{ name: 'xl/workbook.xml', data: '<workbook/>' }]))).toMatchObject({ error: expect.stringContaining('no Word document') });
    expect(docxText(makeZip([{ name: 'word/document.xml', data: '<w:document><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:document>' }]))).toMatchObject({ error: expect.stringContaining('no text in it') });
    const cut = makeZip([{ name: 'word/document.xml', data: DOC }]);
    expect('error' in docxText(cut.subarray(0, cut.length - 30))).toBe(true);
  });
});
