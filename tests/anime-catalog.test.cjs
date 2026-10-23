const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
for (const file of ['server.js', 'worker.js']) {
 const source = fs.readFileSync(`${__dirname}/../Teste/${file}`, 'utf8');
 const extract = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\n}', source.indexOf(`function ${name}(`)) + 2);
 const context = vm.createContext({ URL });
 vm.runInContext(extract('resolver') + '\n' + extract('extrairEpisodios'), context);
 test(`${file}: digital episodes use numeric video URLs and visible episode numbers`, () => {
  const html = '<a href="/video/a/12/"><img alt="Slime Dublado Episódio 02"></a><a href="/video/a/13/">Slime Dublado Episódio 01</a><a href="/video/a/13/">Slime Dublado Episódio 01</a>';
  const eps = context.extrairEpisodios(html, {id:'animesdigital',base:'https://animesdigital.org'}, 'slime');
  assert.equal(eps.length,2); assert.equal(eps[0].numero,1); assert.equal(eps[0].url,'https://animesdigital.org/video/a/13/');
 });
 test(`${file}: retain repeated episode numbers across seasons, exclude unrelated shows`, () => {
  const html = '<a href="/episodio/slime-episodio-1/">1</a><a href="/episodio/slime-2-episodio-1/">1</a><a href="/episodio/other-episodio-2/">2</a>';
  const eps = context.extrairEpisodios(html, {id:'animesonlinecc',base:'https://animesonlinecc.to',reEpisodio:/\/episodio\/([a-z0-9-]+)-episodio-(\d+)\/?$/i}, 'slime');
  assert.equal(eps.length,2); assert.equal(eps[1].temporada,2); assert.notEqual(eps[0].url,eps[1].url);
 });
}
for (const file of ['server.js', 'worker.js']) {
 test(`${file}: only Animes Digital is configured, even for explicit source filters`, () => {
  const source = fs.readFileSync(`${__dirname}/../Teste/${file}`, 'utf8');
  const start = source.indexOf('const FONTES = [');
  const config = source.slice(start, source.indexOf('\n];', start) + 3);
  const sources = vm.runInNewContext(config + '; FONTES');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'animesdigital');
  assert.equal(sources.find(s => s.id === 'animesonlinecc'), undefined);
 });
}
