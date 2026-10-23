/**
 * DragonToons — servidor local
 *
 * Serve o site estatico E uma API de anime normalizada sobre os sites
 * externos (que nao liberam CORS, entao o navegador nao consegue ler).
 *
 * Uso:  node server.js [porta]
 * O site fica em http://127.0.0.1:8787
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

// Cliente do Lycan Toons (Playwright). Carregado sob demanda: se o
// pacote nao estiver instalado, so as rotas /api/lycan/* falham.
let lycan = null;
try {
    lycan = require('./lycan');
} catch (e) {
    console.log('aviso: Lycan Toons indisponivel (' + e.message + ')');
}

// Cliente do Loobyt (ex-NoxManga) - API assinada
const loobyt = require('./loobyt');
const mangadash = require('./mangadash');
const digital = require('./animesdigital');

// Contas, comentarios e historico
const auth = require('./auth');
const db = require('./db');

const PORTA = Number(process.argv[2]) || 8787;
const RAIZ = __dirname;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.jsonl': 'application/json'
};

/* =========================================================
   Fontes de anime
   ========================================================= */

const FONTES = [
    {
        id: 'animesdigital',
        nome: 'Animes Digital',
        base: 'https://animesdigital.org',
        pesquisa: (termo) => '/pesquisa/' + encodeURIComponent(termo) + '/',
        destaques: [{ slug: 'tensei-shitara-slime-datta-ken', titulo: 'Tensei Shitara Slime Datta Ken', capa: '/imagens/slime.jpg' }, {
            slug: 'tensei-shitara-slime-datta-ken-dublado',
            titulo: 'Tensei Shitara Slime Datta Ken Dublado',
            capa: '/imagens/slime.jpg'
        }],
        listagem: '/',
        pagina: '/anime/a/',
        reAnime: /\/anime\/a\/([a-z0-9\-]+)\/?$/i,
        reEpisodio: /\/episodio\/([a-z0-9\-]+)-episodio-(\d+)\/?$/i
    }
];

/* =========================================================
   HTTP: fetch com gzip, redirect e desafio AES
   ========================================================= */

function requestar(url, opcoes = {}, profundidade = 0) {
    return new Promise((resolve, reject) => {
        if (profundidade > 5) return reject(new Error('redirects demais'));
        let u;
        try { u = new URL(url); } catch (e) { return reject(new Error('url invalida: ' + url)); }
        const mod = u.protocol === 'http:' ? http : https;
        const req = mod.request(u, {
            method: opcoes.method || 'GET',
            headers: Object.assign({
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate'
            }, opcoes.headers || {})
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const prox = new URL(res.headers.location, u).toString();
                return resolve(requestar(prox, opcoes, profundidade + 1));
            }
            const pedacos = [];
            res.on('data', (c) => pedacos.push(c));
            res.on('end', () => {
                let buf = Buffer.concat(pedacos);
                const enc = res.headers['content-encoding'];
                try {
                    if (enc === 'gzip') buf = zlib.gunzipSync(buf);
                    else if (enc === 'deflate') buf = zlib.inflateSync(buf);
                } catch (e) { /* deixa como esta */ }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: buf.toString('utf-8')
                });
            });
        });
        req.on('error', reject);
        req.setTimeout(opcoes.timeout || 20000, () => { req.destroy(new Error('timeout')); });
        if (opcoes.body) req.write(opcoes.body);
        req.end();
    });
}

/** Resolve o desafio de cookie AES (padrao "hydra"): a pagina entrega chave/IV/cifrado.
 *  slowAES.decrypt(c, 2, a, b) => modo 2 = CBC. */
function resolverDesafioAes(html) {
    const m = html.match(/toNumbers\("([0-9a-f]+)"\)[^;]*?toNumbers\("([0-9a-f]+)"\)[^;]*?toNumbers\("([0-9a-f]+)"\)/i);
    if (!m) return null;
    const chave = Buffer.from(m[1], 'hex');
    const iv = Buffer.from(m[2], 'hex');
    const cifrado = Buffer.from(m[3], 'hex');
    try {
        const dec = crypto.createDecipheriv('aes-128-cbc', chave, iv);
        dec.setAutoPadding(false);
        const plano = Buffer.concat([dec.update(cifrado), dec.final()]);
        return plano.toString('hex');
    } catch (e) {
        return null;
    }
}

/** Cookies de desafio ja resolvidos, por host. */
const cookiesDesafio = Object.create(null);

/** Baixa uma pagina externa, resolvendo o desafio de cookie se houver. */
async function buscarExterno(url, opcoes = {}) {
    const host = new URL(url).host;
    const headers = Object.assign({}, opcoes.headers || {});
    if (cookiesDesafio[host]) headers.Cookie = cookiesDesafio[host];

    let r = await requestar(url, Object.assign({}, opcoes, { headers }));
    if (r.status === 200 && r.body.indexOf('toNumbers(') !== -1) {
        const cookie = resolverDesafioAes(r.body);
        if (cookie) {
            cookiesDesafio[host] = '__test=' + cookie;
            r = await requestar(url, Object.assign({}, opcoes, {
                headers: Object.assign({}, headers, { Cookie: cookiesDesafio[host] })
            }));
        }
    }
    return r;
}

/* =========================================================
   Parse do HTML
   ========================================================= */

function semTags(html) {
    return decodificarEntidades(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodificarEntidades(s) {
    return String(s)
        .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#0*39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&');
}

function escapar(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extrai blocos <a href="...anime/slug...">...</a> com imagem e titulo. */
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
        const titulo = decodificarEntidades((bloco.match(/alt=["']([^"']+)["']/i) || [])[1] ||
            semTags(bloco).slice(0, 90));
        if (!titulo || titulo.length < 2 || /assistir agora|assistir|watch|ver/i.test(titulo)) {
            // Sem texto util no link: deriva o nome do slug
            const derivado = slug.replace(/[-_]+/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, '').trim();
            if (derivado) {
                achados.push({
                    id: fonte.id + ':' + slug,
                    fonte: fonte.id,
                    fonteNome: fonte.nome,
                    slug: slug,
                    titulo: derivado.charAt(0).toUpperCase() + derivado.slice(1),
                    url: resolver(fonte, href),
                    capa: img ? resolver(fonte, img) : null
                });
                vistos.add(slug);
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

function resolver(fonte, href) {
    try { return new URL(href, fonte.base).toString(); } catch (e) { return href; }
}

/** Extrai a lista de episodios (ou o player) de uma pagina de anime. */
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

const cache = new Map();

function doCache(chave, ttl) {
    const agora = Date.now();
    const item = cache.get(chave);
    if (item && agora - item.tempo < ttl) return item.valor;
    return null;
}

function noCache(chave, valor, ttl) {
    cache.set(chave, { tempo: Date.now(), valor, ttl });
    if (cache.size > 400) {
        const chaves = Array.from(cache.keys()).slice(0, 100);
        chaves.forEach((k) => cache.delete(k));
    }
    return valor;
}

/* =========================================================
   Seguranca: allowlist de destinos (anti-SSRF)
   ========================================================= */

/** Hosts que o servidor tem permissao de buscar. */
const HOSTS_PERMITIDOS = new Set(['animesdigital.org']);

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

function aplicarSeguranca(res) {
    Object.keys(CABECALHOS_SEGURANCA).forEach((k) => {
        try { res.setHeader(k, CABECALHOS_SEGURANCA[k]); } catch (e) { /* ja enviado */ }
    });
    return res;
}

/* =========================================================
   Fontes: consulta e estado
   ========================================================= */

const estadoFonte = {};

async function listarFonte(fonte, termo = '') {
    const pesquisa = fonte.pesquisa && termo.trim();
    const caminho = pesquisa ? fonte.pesquisa(termo.trim()) : fonte.listagem;
    const chave = 'lista:' + fonte.id + ':' + caminho;
    const guardado = doCache(chave, 10 * 60 * 1000);
    if (guardado) return guardado;

    try {
        const r = await buscarExterno(fonte.base + caminho);
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        const lista = extrairAnimes(r.body, fonte);
        estadoFonte[fonte.id] = { ok: true, quando: Date.now(), total: lista.length, erro: null };
        return noCache(chave, lista, 10 * 60 * 1000);
    } catch (e) {
        estadoFonte[fonte.id] = { ok: false, quando: Date.now(), total: 0, erro: e.message };
        return [];
    }
}

async function episodiosDe(fonte, slug) {
    const chave = 'eps:' + fonte.id + ':' + slug;
    const guardado = doCache(chave, 30 * 60 * 1000);
    if (guardado) return guardado;

    const caminho = typeof fonte.pagina === 'function' ? fonte.pagina(slug) : fonte.pagina + slug + '/';
    const r = await buscarExterno(fonte.base + caminho);
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const eps = extrairEpisodios(r.body, fonte, slug);
    return noCache(chave, eps, 30 * 60 * 1000);
}

/* =========================================================
   API
   ========================================================= */

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

    let lista = todas;
    if (termo) {
        const alvo = termo.toLowerCase().trim();
        const palavras = alvo.split(/\s+/).filter((p) => p.length > 1);
        lista = todas.filter((a) => {
            const t = a.titulo.toLowerCase();
            if (!palavras.length) return true;
            // todas as palavras precisam aparecer (ou o titulo inteiro)
            return palavras.every((p) => t.indexOf(p) !== -1) || t.indexOf(alvo) !== -1;
        });
    }

    // dedupe por titulo normalizado, mantendo a primeira fonte que respondeu
    const vistos = new Set();
    const unicos = [];
    for (const a of lista) {
        const chave = a.titulo.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!chave || vistos.has(chave)) continue;
        vistos.add(chave);
        unicos.push(a);
    }
    return unicos;
}

async function apiEpisodios(fonteId, slug) {
    const fonte = FONTES.find((f) => f.id === fonteId);
    if (!fonte) throw new Error('fonte desconhecida: ' + fonteId);
    return episodiosDe(fonte, slug);
}

/* =========================================================
   Servidor
   ========================================================= */

function responderJson(res, dados, status = 200) {
    const corpo = JSON.stringify(dados);
    // setHeader precisa vir ANTES do writeHead (aqui ele ja envia os headers)
    aplicarSeguranca(res);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(corpo),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
    });
    res.end(corpo);
}

/** Arquivos que nunca devem ser servidos publicamente. */
const ARQUIVOS_BLOQUEADOS = new Set([
    'server.js', 'worker.js', 'package.json', 'package-lock.json',
    'wrangler.toml', 'README.md', 'Dockerfile', 'docker-compose.yml'
]);

/** Diretorios que nunca devem ser servidos publicamente. */
const DIRETORIOS_BLOQUEADOS = new Set([
    'deploy', 'node_modules', 'dist', 'build'
]);

/** O arquivo esta na area publica? */
function arquivoPublicavel(alvo, raiz) {
    const rel = path.relative(raiz, alvo);
    const segmentos = rel.split(path.sep);
    // qualquer arquivo/pasta que comeca com ponto fica de fora
    if (segmentos.some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')) return false;
    if (segmentos.some((seg) => DIRETORIOS_BLOQUEADOS.has(seg))) return false;
    if (ARQUIVOS_BLOQUEADOS.has(path.basename(alvo))) return false;
    return true;
}

function servirEstatico(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const alvo = path.join(RAIZ, path.normalize(rel).replace(/^([/\\])+/, ''));
    // o separador final evita que /opt/dragontoons-evil passe no startsWith
    if (!alvo.startsWith(RAIZ + path.sep)) {
        aplicarSeguranca(res);
        res.writeHead(403);
        return res.end('proibido');
    }
    if (!arquivoPublicavel(alvo, RAIZ)) {
        aplicarSeguranca(res);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('nao encontrado');
    }

    fs.stat(alvo, (err, st) => {
        if (err || !st.isFile()) {
            aplicarSeguranca(res);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('nao encontrado');
        }
        const ext = path.extname(alvo).toLowerCase();
        const ehCodigo = ext === '.html' || ext === '.js' || ext === '.css' || ext === '';
        // Imagens: cache longo (nao mudam). Codigo: revalida sempre,
        // senao um CSS/JS novo so chega para quem nao visitou em 7 dias.
        const cache = ehCodigo
            ? 'no-cache'
            : 'public, max-age=604800';
        aplicarSeguranca(res);
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': cache
        });
        fs.createReadStream(alvo).pipe(res);
    });
}

/** Converte uma Web Response (do auth.js) para a resposta do Node. */
async function responderWeb(res, webRes) {
    const headers = {};
    webRes.headers.forEach(function (v, k) { headers[k] = v; });
    const cookies = typeof webRes.headers.getSetCookie === 'function' ? webRes.headers.getSetCookie() : [];
    if (cookies.length) delete headers['set-cookie'];

    aplicarSeguranca(res);
    // Set-Cookie precisa vir ANTES do writeHead
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    res.writeHead(webRes.status, headers);

    const buf = Buffer.from(await webRes.arrayBuffer());
    res.end(buf);
}

const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const p = u.pathname;

    if (req.method === 'OPTIONS') {
        aplicarSeguranca(res);
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    try {
        // ---------- contas, comentarios e historico ----------
        if (p.startsWith('/api/auth/') || p === '/api/comments' || p.startsWith('/api/comments/') || p.startsWith('/api/history')) {
            const resposta = await auth.tratar(req, {}, u);
            if (resposta) return responderWeb(res, resposta);
        }

        if (p.startsWith('/api/mangadash/')) return responderWeb(res, await mangadash.tratar(u));

        // ---------- Loobyt (ex-NoxManga), via API assinada ----------
        if (p === '/api/loobyt/busca') {
            if (!loobyt) return responderJson(res, { erro: 'Loobyt indisponivel' }, 503);
            const termo = u.searchParams.get('q') || '';
            const pagina = Number(u.searchParams.get('pagina')) || 1;
            const d = termo
                ? await loobyt.buscar(termo, pagina, 24)
                : await loobyt.catalogo(pagina, 24);
            return responderJson(res, { total: d.comics.length, obras: d.comics.map(loobyt.adaptar) });
        }

        if (p === '/api/loobyt/capitulos') {
            if (!loobyt) return responderJson(res, { erro: 'Loobyt indisponivel' }, 503);
            const slug = u.searchParams.get('slug');
            if (!slug || !/^[a-z0-9\-]{1,120}$/i.test(slug)) {
                return responderJson(res, { erro: 'slug invalido' }, 400);
            }
            const caps = await loobyt.capitulos(slug);
            return responderJson(res, {
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
            if (!loobyt) return responderJson(res, { erro: 'Loobyt indisponivel' }, 503);
            const cap = u.searchParams.get('cap');
            if (!cap || !/^[a-z0-9\-]{1,120}$/i.test(cap)) {
                return responderJson(res, { erro: 'capitulo invalido' }, 400);
            }
            const pgs = await loobyt.paginas(cap);
            const urls = pgs.map((x) => x.image_url || x.url).filter(Boolean);
            return responderJson(res, { paginas: urls, total: urls.length });
        }

        if (p === '/api/health') {
            return responderJson(res, {
                ok: true,
                uptime: Math.round(process.uptime()),
                fontes: FONTES.length,
                lycan: !!lycan,
                timestamp: new Date().toISOString()
            });
        }

        if (p.startsWith('/api/lycan/') && !lycan) {
            return responderJson(res, { erro: 'Lycan Toons indisponivel neste servidor' }, 503);
        }

        if (p === '/api/fontes') {
            const fontes = FONTES.map((f) => Object.assign({}, {
                id: f.id,
                nome: f.nome,
                base: f.base
            }, estadoFonte[f.id] || { ok: null, total: 0, erro: null }));
            return responderJson(res, { fontes });
        }

        if (p === '/api/anime/lancamentos' || p === '/api/anime/episodio') return responderWeb(res, await digital.tratar(u));

        if (p === '/api/anime/busca') {
            const termo = u.searchParams.get('q') || '';
            const fonte = u.searchParams.get('fonte') || '';
            const lista = await apiBusca(termo, fonte);
            return responderJson(res, { total: lista.length, obras: lista });
        }

        if (p === '/api/anime/player') {
            const alvo = u.searchParams.get('url');
            if (!alvo) return responderJson(res, { erro: 'url obrigatoria' }, 400);
            if (!urlPermitida(alvo)) {
                return responderJson(res, { erro: 'destino nao permitido' }, 403);
            }
            const r = await buscarExterno(alvo);
            const m = r.body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            return responderJson(res, {
                player: m ? m[1] : null,
                url: alvo
            });
        }

        // ---------- Lycan Toons (via Playwright) ----------
        if (p === '/api/lycan/busca') {
            const termo = u.searchParams.get('q') || '';
            const tipo = u.searchParams.get('tipo') || '';
            const paginaNum = Number(u.searchParams.get('pagina')) || 1;
            const dados = termo
                ? await lycan.buscar(termo, { tipo: tipo, pagina: paginaNum, limite: 24 })
                : await lycan.popular(paginaNum, 24);
            const obras = dados.series.map(lycan.adaptar);
            return responderJson(res, { total: obras.length, obras });
        }

        if (p === '/api/lycan/capitulos') {
            const slug = u.searchParams.get('slug');
            if (!slug || !/^[a-z0-9\-]+$/i.test(slug)) {
                return responderJson(res, { erro: 'slug invalido' }, 400);
            }
            const caps = await lycan.capitulos(slug);
            return responderJson(res, { total: caps.length, capitulos: caps });
        }

        if (p === '/api/lycan/paginas') {
            const capId = u.searchParams.get('cap');
            if (!capId || !/^\d+$/.test(capId)) {
                return responderJson(res, { erro: 'capitulo invalido' }, 400);
            }
            const d = await lycan.paginas(Number(capId));
            // as URLs do CDN sao protegidas por Cloudflare: servimos via proxy
            const urls = d.paginas.map((u) => '/api/lycan/img?u=' + encodeURIComponent(u));
            return responderJson(res, { paginas: urls, total: urls.length });
        }

        if (p === '/api/lycan/img') {
            const alvo = u.searchParams.get('u');
            if (!alvo || !/^https:\/\/cdn\.lycantoons\.com\/[A-Za-z0-9\-._~%/?#=&!$'()*+,;:]+$/.test(alvo)) {
                return responderJson(res, { erro: 'destino nao permitido' }, 403);
            }
            const img = await lycan.imagem(alvo);
            res.writeHead(200, {
                'Content-Type': img.tipo,
                'Content-Length': img.corpo.length,
                'Cache-Control': 'public, max-age=86400',
                'X-Content-Type-Options': 'nosniff'
            });
            return res.end(img.corpo);
        }

        const mEp = p.match(/^\/api\/anime\/([a-z0-9]+)\/([a-z0-9\-]+)\/episodios$/i);
        if (mEp) {
            const eps = await apiEpisodios(mEp[1], mEp[2]);
            return responderJson(res, { total: eps.length, episodios: eps });
        }

        if (p.startsWith('/api/')) {
            return responderJson(res, { erro: 'rota desconhecida: ' + p }, 404);
        }
        return servirEstatico(req, res, p);
    } catch (e) {
        console.error('[api]', e);
        return responderJson(res, { erro: e.message }, 500);
    }
});

const HOST = process.env.HOST || '0.0.0.0';
const PORTA_ESCOLHIDA = Number(process.env.PORT) || PORTA;

// Uma requisicao com problema nao pode derrubar o servidor
process.on('uncaughtException', (e) => console.error('[uncaught]', e && e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e && e.message));

servidor.listen(PORTA_ESCOLHIDA, HOST, async () => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log('DragonToons rodando em http://' + shown + ':' + PORTA_ESCOLHIDA);
    console.log('Fontes de anime: ' + FONTES.map((f) => f.id).join(', '));
    try {
        await db.inicializar({});
        console.log('Banco local pronto (.dados/dragontoons.db)');
    } catch (e) {
        console.log('aviso: banco indisponivel (' + e.message + ')');
    }
});

// Encerramento limpo (systemd / docker stop)
function encerrar(sinal) {
    console.log('\n' + sinal + ' recebido, encerrando...');
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
