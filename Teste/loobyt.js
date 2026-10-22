/**
 * Loobyt (ex-NoxManga) - cliente da API.
 *
 * A API (/api/v1/*) exige uma assinatura. O site serve um "signer" em
 * /_nix/signer.js que monta os headers X-Site-ID / X-Web-Slot / X-Web-Token /
 * X-Web-Signature em toda chamada.
 *
 * O signer e um IIFE curto que tem este formato:
 *   const z = [ ...9 strings... ];
 *   r = x => x.split('').reverse().join('');
 *   j = a => a.map(r).join('.');
 *   s = r(z[0]);                  -> slot
 *   k = j(z.slice(1, 4));         -> segredo
 *   t = j(z.slice(4));            -> token
 *   assinatura = base64url(sha256([metodo, path, siteId, s, t, k].join('|')))
 *
 * Importante: o array z muda a cada carga do signer (o token nao e' estavel),
 * entao o signer e a chamada a API tem que acontecer colados. Tambem nao da'
 * pra rodar o script com new Function/eval - o Cloudflare Workers proibe
 * gerar codigo a partir de string, entao a gente le o z por regex e refaz a
 * matematica aqui.
 */

const BASE = 'https://loobyt.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SITE_ID = '00000000-0000-0000-0000-000000000003';

let signerCache = null;   // { slot, token, k }
let signerTempo = 0;
const TTL_SIGNER = 25 * 1000;

const inverter = (x) => String(x).split('').reverse().join('');
const juntar = (a) => a.map(inverter).join('');

/** base64url de um array de bytes (igual o b do signer original). */
function b64url(bytes) {
    let o = '';
    for (let i = 0; i < bytes.length; i++) o += String.fromCharCode(bytes[i]);
    const b = (typeof btoa === 'function')
        ? btoa(o)
        : Buffer.from(bytes).toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Baixa o signer e extrai os componentes (slot, token, k) sem executar nada.
 */
async function carregarSigner(forcar) {
    if (!forcar && signerCache && Date.now() - signerTempo < TTL_SIGNER) {
        return signerCache;
    }

    // ?v= evita o cache do navegador/CDN (o z rotaciona)
    const r = await fetch(BASE + '/_nix/signer.js?v=' + Date.now(), {
        headers: {
            'User-Agent': UA,
            'Referer': BASE + '/',
            'Accept': '*/*',
            'Cookie': 'site_id=' + SITE_ID
        }
    });
    const js = await r.text();

    const m = js.match(/const\s+z\s*=\s*(\[[^\]]*\])/);
    if (!m) throw new Error('nao consegui ler o array z do signer');

    let z;
    try {
        z = JSON.parse(m[1]);
    } catch (e) {
        // JSON nao aceita aspas simples; o signer usa aspas dupras, mas
        // normaliza caso mude
        try {
            z = JSON.parse(m[1].replace(/'/g, '"'));
        } catch (e2) {
            throw new Error('array z invalido');
        }
    }
    if (!Array.isArray(z) || z.length < 9) throw new Error('array z curto');

    signerCache = {
        slot: inverter(z[0]),
        token: juntar(z.slice(4)),
        k: juntar(z.slice(1, 4))
    };
    signerTempo = Date.now();
    return signerCache;
}

/** Assinatura de uma chamada. */
async function assinar(metodo, caminho, forcar) {
    const s = await carregarSigner(forcar);
    const path = String(caminho).split('?')[0];
    const payload = [
        String(metodo || 'GET').toUpperCase(),
        path,
        SITE_ID,
        s.slot,
        s.token,
        s.k
    ].join('|');
    const h = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(payload)
    );
    return { slot: s.slot, token: s.token, signature: b64url(new Uint8Array(h)) };
}

/** Headers assinados para uma chamada na API. */
async function headersAssinados(metodo, caminho, forcar) {
    const sig = await assinar(metodo, caminho, forcar);
    return {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Site-ID': SITE_ID,
        'X-Site-Novo': '1',
        'X-Web-Slot': sig.slot,
        'X-Web-Token': sig.token,
        'X-Web-Signature': sig.signature,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': BASE + '/',
        'Origin': BASE,
        'Cookie': 'site_id=' + SITE_ID,
        'User-Agent': UA
    };
}

/** Chama a API com assinatura (renova o signer uma vez se der 401). */
async function apiGet(caminho, tentativa) {
    const headers = await headersAssinados('GET', caminho, tentativa === 1);
    const r = await fetch(BASE + caminho, { headers });
    const t = await r.text();

    // token expirado/rotacionado: refaz o signer e tenta de novo
    if (r.status === 401 && tentativa !== 1) {
        return apiGet(caminho, 1);
    }

    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 120));
    try {
        return JSON.parse(t);
    } catch (e) {
        throw new Error('resposta nao-JSON');
    }
}

/* =========================================================
   API
   ========================================================= */

/** Catalogo (paginado). */
async function catalogo(pagina = 1, porPagina = 20, extras = '') {
    const d = await apiGet('/api/v1/comics?page=' + pagina + '&per_page=' + porPagina + extras);
    return {
        comics: d.comics || d.data || [],
        meta: d.meta || d.pagination || {}
    };
}

/** Busca por titulo. */
async function buscar(termo, pagina = 1, porPagina = 20) {
    const d = await apiGet('/api/v1/comics?page=' + pagina + '&per_page=' + porPagina + '&q=' + encodeURIComponent(termo));
    return {
        comics: d.comics || d.data || [],
        meta: d.meta || d.pagination || {}
    };
}

/** Generos disponiveis. */
async function generos() {
    const d = await apiGet('/api/v1/genres');
    return d.data || [];
}

/** Detalhe de uma obra. */
async function detalhe(slug) {
    const d = await apiGet('/api/v1/comics/slug/' + encodeURIComponent(slug));
    return d.data || d.comic || d;
}

/** Capitulos de uma obra. */
async function capitulos(slug) {
    const d = await apiGet('/api/v1/comics/slug/' + encodeURIComponent(slug) + '/chapters');
    return d.chapters || d.data || [];
}

/** Paginas (imagens) de um capitulo. */
async function paginas(capituloId) {
    const d = await apiGet('/api/v1/chapters/' + encodeURIComponent(capituloId) + '?skip_view=true');
    return d.pages || d.data || d.images || [];
}

/** Normaliza para o formato que o leitor usa. */
function adaptar(comic) {
    return {
        id: 'loobyt:' + comic.slug,
        fonte: 'loobyt',
        fonteNome: 'Loobyt',
        slug: comic.slug,
        titulo: comic.title || comic.title_alt || comic.slug,
        descricao: comic.synopsis || '',
        autor: comic.author || '',
        generos: comic.genres || comic.genre || [],
        status: comic.status || '',
        tipo: comic.type || comic.format || '',
        capitulos: comic.chapter_count != null ? comic.chapter_count : 0,
        adulto: !!comic.is_adult,
        capa: comic.cover || comic.cover_url || comic.thumbnail || null,
        url: BASE + '/manga/' + comic.slug
    };
}

module.exports = { catalogo, buscar, generos, detalhe, capitulos, paginas, adaptar, BASE, SITE_ID };
