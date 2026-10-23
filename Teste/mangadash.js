// Integração limitada à obra escolhida pelo usuário, sem proxy de URLs arbitrárias.
const BASE = 'https://mangadash.net';
const SLUG = '135-wind-breaker';
const cache = new Map();
async function html(path) {
    const stored = cache.get(path);
    if (stored && stored.until > Date.now()) return stored.text;
    const response = await fetch(BASE + path, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('MangaDash indisponível');
    const text = await response.text();
    cache.set(path, { text, until: Date.now() + 300000 });
    return text;
}
function chapters(text) {
    const found = new Map();
    for (const match of text.matchAll(/href=["']\/capitulo\/135-wind-breaker\/(\d+(?:\.\d+)?)\/?["']/g)) {
        const id = match[1];
        found.set(id, { id, numero: Number(id), titulo: 'Capítulo ' + id, url: BASE + '/capitulo/' + SLUG + '/' + id });
    }
    return [...found.values()].sort((a, b) => a.numero - b.numero);
}
function pdfUrl(text) {
    const match = text.match(/<script\b[^>]*id=["']chapterViewerData["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('Capítulo sem PDF disponível');
    const url = new URL(JSON.parse(match[1]).pdfUrl);
    if (url.origin !== 'https://leitor.mangadash.net' || !url.pathname.startsWith('/storage/mangas/wind_breaker/') || !url.pathname.endsWith('.pdf')) throw new Error('PDF fora da obra selecionada');
    return url.href;
}
async function tratar(url) {
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    try {
        if (url.pathname === '/api/mangadash/capitulos') return reply({ capitulos: chapters(await html('/manga/' + SLUG)) });
        if (url.pathname === '/api/mangadash/pdf') {
            const cap = url.searchParams.get('cap') || '';
            if (!/^\d+(?:\.\d+)?$/.test(cap)) return reply({ erro: 'Capítulo inválido' }, 400);
            const target = pdfUrl(await html('/capitulo/' + SLUG + '/' + cap));
            const response = await fetch(target, { signal: AbortSignal.timeout(30000), redirect: 'manual' });
            if (!response.ok) throw new Error('PDF indisponível');
            return new Response(response.body, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
        }
        return reply({ erro: 'Rota não encontrada' }, 404);
    } catch (error) { return reply({ erro: error.message }, 502); }
}
module.exports = { tratar, chapters, pdfUrl };
