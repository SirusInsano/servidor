/**
 * Lycan Toons - cliente via Playwright.
 *
 * O site (Next.js) usa Cloudflare com managed challenge: qualquer requisicao
 * sem um browser de verdade leva 403 ("Just a moment..."). A solucao e a mesma
 * da extensao do Mihon: abrir um Chromium, deixar a pagina passar pelo
 * desafio e chamar a API de dentro do contexto (mesma origem).
 *
 * So funciona no servidor Node (o Worker nao tem engine JS).
 */

const BASE = 'https://lycantoons.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// candidatos de executavel do Chromium, em ordem de preferencia
const EXECUTAVEIS = [
    process.env.LYCAN_CHROME,
    'C:\\Users\\SirusInsano\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
].filter(Boolean);

let navegador = null;   // navegador aberto (persiste entre chamadas)
let pagina = null;      // aba com o desafio ja resolvido
let iniciando = null;   // promise de inicializacao (evita corrida)

function temPlaywright() {
    try {
        require.resolve('playwright-core');
        return true;
    } catch (e) {
        return false;
    }
}

function acharExecutavel() {
    const fs = require('fs');
    for (const c of EXECUTAVEIS) {
        try { if (fs.existsSync(c)) return c; } catch (e) { /* ignora */ }
    }
    return null;
}

/** Abre (ou reaproveita) o browser e a aba com o desafio resolvido. */
async function garantirPagina() {
    if (pagina && !pagina.isClosed()) return pagina;
    if (iniciando) return iniciando;

    iniciando = (async () => {
        if (!temPlaywright()) {
            throw new Error('playwright-core nao instalado (npm i -g playwright-core)');
        }
        const executavel = acharExecutavel();
        if (!executavel) throw new Error('nenhum Chromium encontrado (defina LYCAN_CHROME)');

        const { chromium } = require('playwright-core');
        navegador = await chromium.launch({
            executablePath: executavel,
            headless: true,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
        });
        const ctx = await navegador.newContext({ userAgent: UA, locale: 'pt-BR' });
        pagina = await ctx.newPage();

        await pagina.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        for (let i = 0; i < 40; i++) {
            const t = await pagina.title();
            if (!/just a moment|attention required/i.test(t)) break;
            await pagina.waitForTimeout(1000);
        }
        iniciando = null;
        return pagina;
    })();

    return iniciando;
}

/** Chama um endpoint da API de dentro da pagina (mesma origem -> passa no Cloudflare). */
async function chamarApi(caminho, opcoes = {}) {
    let ultimoErro;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
        const pg = await garantirPagina();
        try {
            return await pg.evaluate(async ({ caminho, opcoes, base }) => {
                const init = {
                    method: opcoes.method || 'GET',
                    headers: { 'Accept': 'application/json' }
                };
                if (opcoes.body) {
                    init.headers['Content-Type'] = 'application/json';
                    init.body = JSON.stringify(opcoes.body);
                }
                const resp = await fetch(caminho.startsWith('/') ? caminho : base + caminho, init);
                const texto = await resp.text();
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                try {
                    return JSON.parse(texto);
                } catch (e) {
                    throw new Error('resposta nao-JSON');
                }
            }, { caminho, opcoes, base: BASE });
        } catch (e) {
            ultimoErro = e;
            if (!/HTTP 403/.test(e.message)) throw e;
            // o desafio expirou: recarrega a pagina e tenta de novo
            pagina = null;
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    throw ultimoErro;
}

/** Extrai o payload RSC (Next.js) de uma pagina de serie. */
async function extrairRsc(url) {
    const pg = await garantirPagina();
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const html = await pg.evaluate(() => document.documentElement.outerHTML);
    const blocos = [];
    const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    let m;
    while ((m = re.exec(html)) !== null) blocos.push(m[1]);
    return blocos
        .map((b) => b.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'))
        .join('');
}

/* =========================================================
   API publica
   ========================================================= */

/** Catalogo popular. */
async function popular(paginaNum = 1, limite = 20) {
    const d = await chamarApi(`/api/metrics/popular?limit=${limite}&page=${paginaNum}`);
    return { series: d.data || [], pagination: d.pagination || {} };
}

/** Series recentes. */
async function recentes(paginaNum = 1, limite = 20) {
    const d = await chamarApi(`/api/metrics/recently-updated?limit=${limite}&page=${paginaNum}`);
    return { series: d.data || [], pagination: d.pagination || {} };
}

/**
 * Busca. Atencao: `search` e' obrigatorio (vazio devolve 0) e
 * `seriesType`/`status` sao strings, nao arrays.
 */
async function buscar(termo, opcoes = {}) {
    const corpo = {
        limit: opcoes.limite || 20,
        page: opcoes.pagina || 1,
        search: termo || '',
        seriesType: opcoes.tipo || '',
        status: opcoes.status || '',
        tags: opcoes.tags || []
    };
    const d = await chamarApi('/api/series', { method: 'POST', body: corpo });
    return { series: d.series || [], pagination: d.pagination || {} };
}

/** Capitulos de uma serie (vem no payload RSC da pagina). */
async function capitulos(slug) {
    const payload = await extrairRsc(`${BASE}/series/${slug}/1`);
    const m = payload.match(/"capitulos":(\[[\s\S]{0,200000}?\])\s*[,}]/);
    if (!m) return [];
    try {
        const lista = JSON.parse(m[1]);
        return lista.map((c) => ({
            id: c.id,
            numero: c.numero,
            titulo: c.titulo || ('Capítulo ' + c.numero),
            pageCount: c.pageCount,
            vipLockHours: c.vipLockHours || 0
        })).sort((a, b) => b.numero - a.numero);
    } catch (e) {
        return [];
    }
}

/** URLs das paginas de um capitulo. */
async function paginas(capituloId) {
    const d = await chamarApi(`/api/chapters/${capituloId}/view-pages`);
    return { paginas: d.pages || [], pageCount: d.pageCount, numero: d.numero };
}

/* =========================================================
   Imagens
   O CDN (cdn.lycantoons.com) tambem usa Cloudflare: a URL
   crua devolve 403 e um <img> nao resolve challenge. Entao
   resolvemos o desafio do CDN uma vez no browser e baixamos
   pelo contexto (que compartilha os cookies).
   ========================================================= */

const clearanceCdn = Object.create(null);
let paginaCdn = null;   // aba separada: navegar no CDN nao quebra a sessao do site

async function imagem(url) {
    const pg = await garantirPagina();
    const host = new URL(url).host;

    if (!clearanceCdn[host]) {
        // aba separada so para o CDN
        if (!paginaCdn || paginaCdn.isClosed()) {
            paginaCdn = await pg.context().newPage();
        }
        try {
            await paginaCdn.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) { /* imagem nao "carrega" como pagina; o cookie pode ja ter sido setado */ }
        // se ainda for o desafio, recarrega (o cookie ja deve estar valido)
        try {
            const t = await paginaCdn.title();
            if (/just a moment/i.test(t)) {
                await paginaCdn.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
            }
        } catch (e) { /* ignora */ }
        clearanceCdn[host] = true;
    }

    const resp = await pg.context().request.get(url, { timeout: 40000, failOnStatusCode: false });
    if (!resp.ok()) throw new Error('HTTP ' + resp.status());
    const tipo = resp.headers()['content-type'] || 'image/jpeg';
    return { corpo: await resp.body(), tipo };
}

/** Normaliza para o formato que o leitor usa. */
function adaptar(serie) {
    return {
        id: 'lycantoons:' + serie.slug,
        fonte: 'lycantoons',
        fonteNome: 'Lycan Toons',
        slug: serie.slug,
        titulo: serie.title,
        original: serie.original_title || '',
        descricao: serie.description || '',
        autor: serie.author || serie.artist || '',
        generos: serie.genre || [],
        status: serie.status || '',
        tipo: serie.seriesType || '',
        capitulos: serie.last_chapters ? serie.last_chapters.length : 0,
        capa: serie.coverUrl || null,
        url: BASE + '/series/' + serie.slug
    };
}

/** Fecha o browser (chame no shutdown). */
async function fechar() {
    if (navegador) {
        try { await navegador.close(); } catch (e) { /* ignora */ }
        navegador = null;
        pagina = null;
    }
}

module.exports = { popular, recentes, buscar, capitulos, paginas, imagem, adaptar, fechar, BASE, temPlaywright };
