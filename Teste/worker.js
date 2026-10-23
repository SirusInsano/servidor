/**
 * DragonToons - API de anime como Cloudflare Worker (plano gratuito)
 *
 * Substitui o server.js no deploy em Workers/Pages.
 * Regras:
 *   - assets estaticos servidos pelo binding ASSETS
 *   - /api/* roda neste Worker
 *   - cache no edge (Cache API) para nao repetir fetch nas fontes
 */

import { createDecipheriv } from 'node:crypto';
import auth from './auth';
import loobyt from './loobyt';
import mangadash from './mangadash';

const FONTES = [
    {
        id: 'animesonlinecc',
        nome: 'Animes Online',
        base: 'https://animesonlinecc.to',
        // Obras escolhidas para a home, mesmo fora da primeira página da fonte.
        destaques: [{
            slug: 'tensei-shitara-slime-datta-ken',
            titulo: 'Tensei Shitara Slime Datta Ken',
            capa: '/imagens/slime.jpg'
        }],
        listagem: '/anime/',
        pagina: '/anime/',
        reAnime: /\/anime\/([a-z0-9\-]+)\/?$/i,
        reEpisodio: /\/episodio\/([a-z0-9\-]+)-episodio-(\d+)\/?$/i
    },
    {
        id: 'animesdigital',
        nome: 'Animes Digital',
        base: 'https://animesdigital.org',
        pesquisa: (termo) => '/pesquisa/' + encodeURIComponent(termo) + '/',
        destaques: [{
            slug: 'tensei-shitara-slime-datta-ken-dublado',
            titulo: 'Tensei Shitara Slime Datta Ken Dublado',
            capa: '/imagens/slime.jpg'
        }],
        listagem: '/',
        pagina: '/anime/a/',
        reAnime: /\/anime\/a\/([a-z0-9\-]+)\/?$/i,
        reEpisodio: /\/episodio\/([a-z0-9\-]+)-episodio-(\d+)\/?$/i
    },
    {
        id: 'meusanimes',
        nome: 'Meus Animes',
        base: 'https://meusanimes.blog',
        listagem: '/a/',
        pagina: '/a/',
        reAnime: /\/a\/([a-z0-9\-]+)\/?$/i,
        reEpisodio: /\/episodio\/([a-z0-9\-]+)-episodio-(\d+)\/?$/i
    },
    {
        id: 'assistiranimesonline',
        nome: 'Assistir Animes Online',
        base: 'https://assistiranimesonline.net',
        listagem: '/animes/',
        pagina: '/anime/',
        reAnime: /\/anime\/([a-z0-9\-]+)\/?$/i,
        reEpisodio: /\/episodio\/([a-z0-9\-]+)-episodio-(\d+)\/?$/i
    },
    {
        id: 'hydraani',
        nome: 'Hydra Ani',
        base: 'https://hydraani.free.nf',
        listagem: '/',
        pagina: (slug) => '/?slug=' + encodeURIComponent(slug),
        reAnime: /[?&]slug=([a-z0-9\-]+)/i,
        rePlayer: /<iframe[^>]+src=["']([^"']+)["']/i,
        // fonte de conteudo adulto: so entra em "Hentai Anime"
        adulto: true
    }
];

/* cookies de desafio ja resolvidos, por host */
const cookiesDesafio = Object.create(null);
/* cache em memoria do isolate (evita refetch no mesmo warm start) */
const memoria = new Map();
const TTL_MEMORIA = 5 * 60 * 1000;

/* =========================================================
   Seguranca: allowlist de destinos (anti-SSRF)
   ========================================================= */

/** Hosts que o Worker tem permissao de buscar. */
const HOSTS_PERMITIDOS = new Set([
    'animesonlinecc.to',
    'animesdigital.org',
    'meusanimes.blog',
    'assistiranimesonline.net',
    'hydraani.free.nf',
    'blogger.com',
    'blogger.googleusercontent.com',
    'dri.me',
    'hydra-player-worker.gamesdonghuax.workers.dev'
]);

/** Redes privadas/link-local que nunca devem ser alcancadas. */
function hostPrivado(host) {
    const h = host.toLowerCase();
    if (h === 'localhost' || h === '0.0.0.0') return true;
    if (h === '::1' || h === '[::1]') return true;
    if (/^127\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;      // metadados da nuvem
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.localhost')) return true;
    return false;
}

/** So passa se o host estiver na allowlist E nao for rede privada. */
function urlPermitida(url) {
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (hostPrivado(host)) return false;
    if (HOSTS_PERMITIDOS.has(host)) return true;
    if (host.startsWith('www.') && HOSTS_PERMITIDOS.has(host.slice(4))) return true;
    return false;
}

/* =========================================================
   Cabecalhos de seguranca
   ========================================================= */

const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https: data:",
    'frame-src https:',
    "connect-src 'self' https://api.vegitoons.black",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'"
].join('; ');

const CABECALHOS_SEGURANCA = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

/** Aplica os cabecalhos de seguranca a uma resposta. */
function comSeguranca(res) {
    const novo = new Response(res.body, res);
    Object.keys(CABECALHOS_SEGURANCA).forEach((k) => {
        novo.headers.set(k, CABECALHOS_SEGURANCA[k]);
    });
    return novo;
}

/* =========================================================
   Crypto: AES-CBC sem padding (modo 2 do slowAES)
   ========================================================= */

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
}

/**
 * Descriptografa AES-CBC sem padding (modo 2 do slowAES).
 * Usa node:crypto porque o WebCrypto recusa AES-CBC sem PKCS#7 valido.
 */
function decryptCbcSemPadding(cifrado, chave, iv) {
    const dec = createDecipheriv('aes-128-cbc', chave, iv);
    dec.setAutoPadding(false);
    return Buffer.concat([dec.update(cifrado), dec.final()]);
}

function resolverDesafioAes(html) {
    const m = html.match(/toNumbers\("([0-9a-f]+)"\)[^;]*?toNumbers\("([0-9a-f]+)"\)[^;]*?toNumbers\("([0-9a-f]+)"\)/i);
    if (!m) return null;
    return {
        chave: hexToBytes(m[1]),
        iv: hexToBytes(m[2]),
        cifrado: hexToBytes(m[3])
    };
}

/* =========================================================
   HTTP de saida
   ========================================================= */

const NAVEGADOR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

async function buscarExterno(url, opcoes = {}) {
    const host = new URL(url).host;
    const headers = Object.assign({}, NAVEGADOR, opcoes.headers || {});
    if (cookiesDesafio[host]) headers.Cookie = cookiesDesafio[host];

    let resposta = await fetch(url, { headers, redirect: 'follow' });
    let texto = await resposta.text();

    // desafio de cookie AES: resolve e tenta de novo
    if (texto.indexOf('toNumbers(') !== -1) {
        const desafio = resolverDesafioAes(texto);
        if (desafio) {
            const plano = decryptCbcSemPadding(desafio.cifrado, desafio.chave, desafio.iv);
            cookiesDesafio[host] = '__test=' + bytesToHex(plano);
            headers.Cookie = cookiesDesafio[host];
            resposta = await fetch(url, { headers, redirect: 'follow' });
            texto = await resposta.text();
        }
    }

    return { status: resposta.status, texto };
}

/* =========================================================
   Parse do HTML
   ========================================================= */

function semTags(html) {
    return decodificarEntidades(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodificarEntidades(s) {
    return String(s)
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#0*39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&');
}

function resolver(fonte, href) {
    try { return new URL(href, fonte.base).toString(); } catch (e) { return href; }
}

/** Extrai a URL da imagem de um bloco <a>. */
function extrairCapa(bloco) {
    const reImg = /<img[^>]+src=["']([^"']+)["']/i;
    const reData = /<img[^>]+data-src=["']([^"']+)["']/i;
    const reBg = /background-image\s*:\s*url\(['"]?([^'")]+)/i;
    // match() devolve um array: o grupo capturado e' o indice [1]
    const m = bloco.match(reImg) || bloco.match(reData) || bloco.match(reBg);
    return m && typeof m[1] === 'string' ? m[1] : null;
}

function extrairAnimes(html, fonte) {
    const reA = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const achados = [];
    const vistos = new Set();
    let m;

    while ((m = reA.exec(html)) !== null) {
        const href = m[1];
        const bloco = m[2];
        const achado = href.match(fonte.reAnime);
        if (!achado) continue;
        const slug = achado[1];
        if (!slug || vistos.has(slug)) continue;

        const img = extrairCapa(bloco);

        let titulo = decodificarEntidades((bloco.match(/alt=["']([^"']+)["']/i) || [])[1] ||
            semTags(bloco).slice(0, 90));

        if (!titulo || titulo.length < 2 || /assistir agora|assistir|watch|ver/i.test(titulo)) {
            const derivado = slug.replace(/[-_]+/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, '').trim();
            if (derivado) {
                vistos.add(slug);
                achados.push({
                    id: fonte.id + ':' + slug,
                    fonte: fonte.id,
                    fonteNome: fonte.nome,
                    slug: slug,
                    titulo: derivado.charAt(0).toUpperCase() + derivado.slice(1),
                    url: resolver(fonte, href),
                    capa: img ? resolver(fonte, img) : null
                });
                continue;
            }
        }
        if (!titulo) continue;

        vistos.add(slug);
        achados.push({
            id: fonte.id + ':' + slug,
            fonte: fonte.id,
            fonteNome: fonte.nome,
            slug: slug,
            titulo: titulo,
            url: resolver(fonte, href),
            capa: img ? resolver(fonte, img) : null
        });
    }
    return achados;
}

function extrairEpisodios(html, fonte, slug) {
    if (fonte.id === 'animesdigital') {
        const episodios = new Map();
        const links = /<a\b[^>]*href=["']([^"']*\/video\/a\/\d+\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
        for (const link of html.matchAll(links)) {
            const numero = link[2].match(/Epis[oó]dio\s*(\d+)/i);
            if (!numero) continue;
            const url = resolver(fonte, link[1]);
            episodios.set(url, { numero: Number(numero[1]), titulo: 'Episódio ' + Number(numero[1]), url });
        }
        if (episodios.size) return [...episodios.values()].sort((a, b) => a.numero - b.numero);
    }
    if (fonte.rePlayer) {
        const m = html.match(fonte.rePlayer);
        if (!m) return [];
        const player = resolver(fonte, m[1]);
        return [{ numero: 1, titulo: 'Assistir', url: player, player: player }];
    }

    const reHref = /href=["']([^"']+)["']/gi;
    const mapa = new Map();
    let m;
    while ((m = reHref.exec(html)) !== null) {
        const achado = m[1].match(fonte.reEpisodio);
        if (!achado) continue;
        // Não confundir recomendações da página com episódios desta obra.
        if (fonte.id === 'animesonlinecc' && slug &&
            achado[1] !== slug && !achado[1].startsWith(slug + '-')) continue;
        const num = Number(achado[2]);
        const sufixo = slug && achado[1].startsWith(slug + '-')
            ? achado[1].slice(slug.length + 1) : '';
        const temporada = /^\d+$/.test(sufixo) ? Number(sufixo) : 1;
        const url = resolver(fonte, m[1]);
        // Cada temporada pode ter um episódio 1: a URL identifica o episódio.
        if (!mapa.has(url)) {
            mapa.set(url, {
                numero: num,
                temporada,
                titulo: 'Episódio ' + num,
                url
            });
        }
    }
    const episodios = Array.from(mapa.values());
    if (episodios.some((ep) => ep.temporada > 1)) {
        episodios.forEach((ep) => {
            ep.titulo = 'Temporada ' + ep.temporada + ' · Episódio ' + ep.numero;
        });
    }
    return episodios.sort((a, b) => a.temporada - b.temporada || a.numero - b.numero);
}

/* =========================================================
   Cache
   ========================================================= */

function daMemoria(chave) {
    const item = memoria.get(chave);
    if (item && Date.now() - item.tempo < TTL_MEMORIA) return item.valor;
    return null;
}

function naMemoria(chave, valor) {
    if (memoria.size > 300) {
        const chaves = Array.from(memoria.keys()).slice(0, 100);
        chaves.forEach((k) => memoria.delete(k));
    }
    memoria.set(chave, { tempo: Date.now(), valor });
    return valor;
}

const CACHE_TTL_LISTA = 600;   // 10 min
const CACHE_TTL_EPS = 1800;    // 30 min
const CACHE_TTL_PLAYER = 600;

/**
 * Versao do cache. incremente sempre que mudar o parser ou as fontes:
 * a edge guarda a resposta antiga por 10 min e nao invalida no deploy.
 */
const VERSAO_CACHE = 'v4-slime';

/** Chave de cache versionada (independe da query da URL). */
function requisicaoCache(request) {
    const u = new URL(request.url);
    u.searchParams.set('_cv', VERSAO_CACHE);
    return new Request(u.toString(), { method: 'GET' });
}

/** Tenta servir do cache da edge. Devolve null se nao houver. */
async function doEdge(request) {
    if (typeof caches === 'undefined') return null;
    try {
        const res = await caches.default.match(requisicaoCache(request));
        if (!res) return null;
        const clone = new Response(res.body, res);
        clone.headers.set('X-Cache', 'HIT');
        return clone;
    } catch (e) {
        return null;
    }
}

/** Guarda no cache da edge (a proxima request pode ser servida sem CPU nenhuma). */
async function noEdge(request, corpo, ttl) {
    const res = new Response(JSON.stringify(corpo), {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=' + ttl
        }
    });
    if (typeof caches !== 'undefined') {
        try { await caches.default.put(requisicaoCache(request), res.clone()); } catch (e) { /* ignora */ }
    }
    return res;
}

/* =========================================================
   Consulta as fontes
   ========================================================= */

const estadoFonte = Object.create(null);

async function listarFonte(fonte, termo = '') {
    const pesquisa = fonte.pesquisa && termo.trim();
    const caminho = pesquisa ? fonte.pesquisa(termo.trim()) : fonte.listagem;
    const chave = 'lista:' + fonte.id + ':' + caminho;
    const guardado = daMemoria(chave);
    if (guardado) return guardado;

    try {
        const r = await buscarExterno(fonte.base + caminho);
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        const lista = extrairAnimes(r.texto, fonte);
        estadoFonte[fonte.id] = { ok: true, total: lista.length, erro: null };
        return naMemoria(chave, lista);
    } catch (e) {
        estadoFonte[fonte.id] = { ok: false, total: 0, erro: e.message };
        return [];
    }
}

async function episodiosDe(fonte, slug) {
    const chave = 'eps:' + fonte.id + ':' + slug;
    const guardado = daMemoria(chave);
    if (guardado) return guardado;

    const caminho = typeof fonte.pagina === 'function' ? fonte.pagina(slug) : fonte.pagina + slug + '/';
    const r = await buscarExterno(fonte.base + caminho);
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const eps = extrairEpisodios(r.texto, fonte, slug);
    return naMemoria(chave, eps);
}

async function apiBusca(termo, somenteFonte) {
    // Sem filtro explicito as fontes adultas ficam de fora (so entram em
    // "Hentai Anime", que exige confirmacao de idade).
    const ativas = somenteFonte
        ? FONTES.filter((f) => f.id === somenteFonte)
        : FONTES.filter((f) => !f.adulto);

    const resultados = await Promise.all(ativas.map((f) => listarFonte(f, termo)));
    const destaques = ativas.flatMap((f) => (f.destaques || []).map((a) => ({
        ...a,
        id: f.id + ':' + a.slug,
        fonte: f.id,
        fonteNome: f.nome,
        url: resolver(f, f.pagina + a.slug + '/')
    })));
    let todas = destaques.concat(...resultados);

    if (somenteFonte) {
        todas = todas.filter((a) => a.fonte === somenteFonte);
    }

    if (termo) {
        const alvo = termo.toLowerCase().trim();
        const palavras = alvo.split(/\s+/).filter((p) => p.length > 1);
        todas = todas.filter((a) => {
            const t = a.titulo.toLowerCase();
            if (!palavras.length) return true;
            return palavras.every((p) => t.indexOf(p) !== -1) || t.indexOf(alvo) !== -1;
        });
    }

    const vistos = new Set();
    const unicos = [];
    for (const a of todas) {
        const chave = a.titulo.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!chave || vistos.has(chave)) continue;
        vistos.add(chave);
        unicos.push(a);
    }
    return unicos;
}

/* =========================================================
   Rotas
   ========================================================= */

function json(dados, status = 200) {
    return new Response(JSON.stringify(dados), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
        }
    });
}

export default {
    async fetch(request, env) {
        return comSeguranca(await tratar(request, env));
    }
};

async function tratar(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    try {
        // ---------- contas, comentarios e historico ----------
        if (p.startsWith('/api/auth/') || p === '/api/comments' || p.startsWith('/api/comments/') || p.startsWith('/api/history')) {
            const resposta = await auth.tratar(request, env, url);
            if (resposta) return comSeguranca(resposta);
        }

        if (p.startsWith('/api/mangadash/')) return comSeguranca(await mangadash.tratar(url));

        // ---------- Loobyt (ex-NoxManga), via API assinada ----------
        if (p === '/api/loobyt/busca') {
            const termo = url.searchParams.get('q') || '';
            const pagina = Number(url.searchParams.get('pagina')) || 1;
            const d = termo
                ? await loobyt.buscar(termo, pagina, 24)
                : await loobyt.catalogo(pagina, 24);
            return json({ total: d.comics.length, obras: d.comics.map(loobyt.adaptar) });
        }

        if (p === '/api/loobyt/capitulos') {
            const slug = url.searchParams.get('slug');
            if (!slug || !/^[a-z0-9\-]{1,120}$/i.test(slug)) {
                return json({ erro: 'slug invalido' }, 400);
            }
            const caps = await loobyt.capitulos(slug);
            return json({
                total: caps.length,
                capitulos: caps.map((c) => ({
                    id: c.id,
                    numero: c.number,
                    titulo: c.title || ('Capítulo ' + c.number),
                    paginas: c.page_count,
                    bloqueado: !!c.locked
                }))
            });
        }

        if (p === '/api/loobyt/paginas') {
            const cap = url.searchParams.get('cap');
            if (!cap || !/^[a-z0-9\-]{1,120}$/i.test(cap)) {
                return json({ erro: 'capitulo invalido' }, 400);
            }
            const pgs = await loobyt.paginas(cap);
            const urls = pgs.map((x) => x.image_url || x.url).filter(Boolean);
            return json({ paginas: urls, total: urls.length });
        }

        if (p === '/api/health') {
            return json({ ok: true, fontes: FONTES.length, timestamp: new Date().toISOString() });
        }

            if (p === '/api/fontes') {
                // consulta de verdade para o estado refletir a realidad
                // (o cache da edge pode ter servido a resposta ja pronta)
                await Promise.all(FONTES.map((f) => listarFonte(f)));
                const fontes = FONTES.map((f) => Object.assign(
                    { id: f.id, nome: f.nome, base: f.base },
                    estadoFonte[f.id] || { ok: null, total: 0, erro: null }
                ));
                return json({ fontes });
            }

            if (p === '/api/anime/busca') {
                const doCache = await doEdge(request);
                if (doCache) return doCache;
                const termo = url.searchParams.get('q') || '';
                const fonte = url.searchParams.get('fonte') || '';
                const lista = await apiBusca(termo, fonte);
                return noEdge(request, { total: lista.length, obras: lista }, CACHE_TTL_LISTA);
            }

            if (p === '/api/anime/player') {
                const doCache = await doEdge(request);
                if (doCache) return doCache;
                const alvo = url.searchParams.get('url');
                if (!alvo) return json({ erro: 'url obrigatoria' }, 400);
                if (!urlPermitida(alvo)) {
                    return json({ erro: 'destino nao permitido' }, 403);
                }
                const r = await buscarExterno(alvo);
                const m = r.texto.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                return noEdge(request, { player: m ? m[1] : null, url: alvo }, CACHE_TTL_PLAYER);
            }

            const mEp = p.match(/^\/api\/anime\/([a-z0-9]+)\/([a-z0-9\-]+)\/episodios$/i);
            if (mEp) {
                const doCache = await doEdge(request);
                if (doCache) return doCache;
                const fonte = FONTES.find((f) => f.id === mEp[1]);
                if (!fonte) return json({ erro: 'fonte desconhecida' }, 404);
                const eps = await episodiosDe(fonte, mEp[2]);
                return noEdge(request, { total: eps.length, episodios: eps }, CACHE_TTL_EPS);
            }

            if (p.startsWith('/api/')) {
                return json({ erro: 'rota desconhecida: ' + p }, 404);
            }

            // estaticos: deixa o binding ASSETS responder
            if (env && env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            return new Response('nao encontrado', { status: 404 });
        } catch (e) {
            return json({ erro: e.message }, 500);
        }
}
