const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releases, tratar } = require('../Teste/animesdigital');
test('release feed uses episode cards, not series or navigation links', () => {
 const card = '<a href="https://animesdigital.org/video/a/42/"><img src="/cover.jpg"><span class="title_anime">Slime &amp; amigos</span><span>Episódio 03</span></a>';
 const list = releases(card + card + '<a href="/anime/a/slime">Slime</a><a href="/video/a/43/">Próximo</a>');
 assert.equal(list.length, 1); assert.equal(list[0].id,'42'); assert.equal(list[0].numero,3); assert.equal(list[0].titulo,'Slime & amigos');
});
test('invalid page and episode identifiers cannot change the upstream path', async () => {
 for (const route of ['/lancamentos?pagina=-1','/lancamentos?pagina=1.5','/episodio?id=../admin']) {
  assert.equal((await tratar(new URL('https://example.com/api/anime'+route))).status,400);
 }
});
