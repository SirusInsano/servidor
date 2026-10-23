const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chapters, pdfUrl, tratar } = require('../Teste/mangadash');
test('chapters preserve decimals, remove duplicate links and ignore other works', () => {
 const html = '<a href="/capitulo/135-wind-breaker/2"><a href="/capitulo/135-wind-breaker/1.5"><a href="/capitulo/135-wind-breaker/2"><a href="/capitulo/999-other/1">';
 assert.deepEqual(chapters(html).map(c => c.numero), [1.5, 2]);
});
test('PDF source cannot become an arbitrary URL proxy', async () => {
 const document = url => '<script id="chapterViewerData">' + JSON.stringify({pdfUrl:url}) + '</script>';
 assert.equal(pdfUrl(document('https://leitor.mangadash.net/storage/mangas/wind_breaker/01.pdf')), 'https://leitor.mangadash.net/storage/mangas/wind_breaker/01.pdf');
 for (const url of ['https://evil.test/a.pdf', 'https://leitor.mangadash.net/storage/mangas/other/a.pdf']) assert.throws(() => pdfUrl(document(url)));
 const r = await tratar(new URL('http://localhost/api/mangadash/pdf?cap=../../other'));
 assert.equal(r.status,400);
});
