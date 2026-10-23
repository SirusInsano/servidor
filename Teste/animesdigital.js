// Listagem pública de lançamentos do Animes Digital.
const BASE = 'https://animesdigital.org';
function plain(value) {
    return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();
}
function releases(html) {
    const results = new Map();
    for (const link of html.matchAll(/<a\b[^>]*href=["'](?:https:\/\/animesdigital\.org)?\/video\/a\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const block = link[2];
        const title = block.match(/class=["']title_anime["'][^>]*>([\s\S]*?)<\//i);
        const number = block.match(/Epis[oó]dio\s*(\d+(?:\.\d+)?)/i);
        if (!title || !number) continue;
        const cover = block.match(/<img[^>]*(?:data-src|src)=["']([^"']+)["']/i);
        results.set(link[1], { id: link[1], titulo: plain(title[1]), numero: Number(number[1]), capa: cover ? new URL(cover[1], BASE).href : null, url: BASE + '/video/a/' + link[1] + '/' });
    }
    return [...results.values()];
}
async function get(path) {
    const r = await fetch(BASE + path, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('Animes Digital indisponível');
    return r.text();
}
async function tratar(url) {
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=120' : 'no-store' } });
    try {
        if (url.pathname === '/api/anime/lancamentos') {
            const page = Number(url.searchParams.get('pagina') || 1);
            if (!Number.isInteger(page) || page < 1 || page > 5000) return json({ erro: 'Página inválida' }, 400);
            const html = await get(page === 1 ? '/lancamentos01' : '/lancamentos01/page/' + page + '/');
            const episodios = releases(html);
            return json({ episodios, pagina: page, mais: html.includes('/lancamentos01/page/' + (page + 1) + '/') });
        }
        const id = url.searchParams.get('id') || '';
        if (!/^\d+$/.test(id)) return json({ erro: 'Episódio inválido' }, 400);
        const html = await get('/video/a/' + id + '/');
        const match = html.match(/href=["'](?:https:\/\/animesdigital\.org)?\/anime\/a\/([a-z0-9-]+)\/?["']/i);
        if (!match) return json({ erro: 'Anime deste episódio não encontrado' }, 404);
        return json({ slug: match[1], url: BASE + '/video/a/' + id + '/' });
    } catch (e) { return json({ erro: e.message }, 502); }
}
module.exports = { releases, tratar };
