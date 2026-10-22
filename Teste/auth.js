/**
 * API de contas, comentarios e historico.
 * Mesma implementacao no Worker (D1) e no servidor Node (node:sqlite).
 */
'use strict';

// usa o Web Crypto global (existe no Node 22 e no Worker)
const crypto = globalThis.crypto;

const COOKIE = 'aw_sessao';
const DIAS_SESSAO = 30;
const TAM_SALT = 16;
const ITERACOES = 100000;

/* =========================================================
   Senha (PBKDF2-SHA256) - funciona no Node e no Worker
   ========================================================= */

function paraHex(buf) {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function deHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

async function derivar(senha, saltHex) {
    const chave = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(senha), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: deHex(saltHex), iterations: ITERACOES, hash: 'SHA-256' },
        chave, 256
    );
    return paraHex(bits);
}

function saltAleatorio() {
    const bytes = new Uint8Array(TAM_SALT);
    crypto.getRandomValues(bytes);
    return paraHex(bytes);
}

function tokenAleatorio() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return paraHex(bytes);
}

function timingSeguro(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/* =========================================================
   Sessoes
   ========================================================= */

async function criarSessao(db, userId) {
    const token = tokenAleatorio();
    const expira = new Date(Date.now() + DIAS_SESSAO * 86400000).toISOString();
    await db.run('INSERT INTO sessions (token, user_id, expira_em) VALUES (?, ?, ?)', [token, userId, expira]);
    return { token, expira };
}

async function usuarioDaRequisicao(db, req) {
    const headers = req.headers || {};
    // Node: objeto comum. Worker: Headers (precisa de .get)
    const cookie = typeof headers.get === 'function'
        ? (headers.get('cookie') || '')
        : (headers.cookie || '');
    const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
    if (!m) return null;
    const token = decodeURIComponent(m[1]);
    const row = await db.first(
        'SELECT u.id, u.username, u.email, u.criado_em, s.expira_em FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
        [token]
    );
    if (!row) return null;
    if (new Date(row.expira_em).getTime() < Date.now()) {
        await db.run('DELETE FROM sessions WHERE token = ?', [token]);
        return null;
    }
    return { id: row.id, username: row.username, email: row.email, criado_em: row.criado_em, token };
}

/* =========================================================
   Helpers de resposta
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

function erro(mensagem, status = 400) {
    return json({ erro: mensagem }, status);
}

function cookieSessao(token, expira) {
    return COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Expires=' +
        new Date(expira).toUTCString() + (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

function cookieLimpo() {
    return COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function texto(valor, max) {
    return String(valor == null ? '' : valor).trim().slice(0, max || 2000);
}

/** Le o corpo JSON. Funciona no Worker (Request) e no Node (IncomingMessage). */
async function lerJson(req) {
    if (typeof req.json === 'function') return req.json();
    const partes = [];
    for await (const p of req) partes.push(p);
    const bruto = Buffer.concat(partes).toString('utf8');
    if (!bruto) throw new Error('corpo vazio');
    return JSON.parse(bruto);
}

/* =========================================================
   Rotas
   ========================================================= */

async function tratar(req, env, url) {
    const db = require('./db').obter(env);
    const rota = url.pathname;

    /* ---------- cadastro ---------- */
    if (rota === '/api/auth/registrar' && req.method === 'POST') {
        let dados;
        try { dados = await lerJson(req); } catch (e) { return erro('corpo invalido'); }
        const username = texto(dados.username, 32);
        const email = texto(dados.email, 160).toLowerCase();
        const senha = String(dados.senha || '');

        if (username.length < 3) return erro('usuario precisa de 3+ caracteres');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro('email invalido');
        if (senha.length < 6) return erro('senha precisa de 6+ caracteres');

        const existente = await db.first('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existente) return erro('usuario ou email ja existe', 409);

        const salt = saltAleatorio();
        const hash = await derivar(senha, salt);
        const r = await db.run(
            'INSERT INTO users (username, email, senha_hash, senha_salt) VALUES (?, ?, ?, ?)',
            [username, email, hash, salt]
        );
        const userId = r.changes ? Number(r.lastInsertRowid || 0) : 0;
        const id = userId || (await db.first('SELECT id FROM users WHERE username = ?', [username])).id;
        const sessao = await criarSessao(db, id);

        const resp = json({ ok: true, user: { id, username, email } });
        resp.headers.append('Set-Cookie', cookieSessao(sessao.token, sessao.expira));
        return resp;
    }

    /* ---------- login ---------- */
    if (rota === '/api/auth/login' && req.method === 'POST') {
        let dados;
        try { dados = await lerJson(req); } catch (e) { return erro('corpo invalido'); }
        const identificador = texto(dados.identificador, 160).toLowerCase();
        const senha = String(dados.senha || '');

        const user = await db.first('SELECT * FROM users WHERE lower(username) = ? OR email = ?', [identificador, identificador]);
        if (!user) return erro('usuario ou senha incorretos', 401);

        const hash = await derivar(senha, user.senha_salt);
        if (!timingSeguro(hash, user.senha_hash)) return erro('usuario ou senha incorretos', 401);

        await db.run('UPDATE users SET ultimo_login = datetime(\'now\') WHERE id = ?', [user.id]);
        const sessao = await criarSessao(db, user.id);

        const resp = json({ ok: true, user: { id: user.id, username: user.username, email: user.email } });
        resp.headers.append('Set-Cookie', cookieSessao(sessao.token, sessao.expira));
        return resp;
    }

    /* ---------- logout ---------- */
    if (rota === '/api/auth/logout' && req.method === 'POST') {
        const user = await usuarioDaRequisicao(db, req);
        if (user) await db.run('DELETE FROM sessions WHERE token = ?', [user.token]);
        const resp = json({ ok: true });
        resp.headers.append('Set-Cookie', cookieLimpo());
        return resp;
    }

    /* ---------- eu ---------- */
    if (rota === '/api/auth/eu') {
        const user = await usuarioDaRequisicao(db, req);
        if (!user) return json({ user: null });
        return json({ user: { id: user.id, username: user.username, email: user.email, criado_em: user.criado_em } });
    }

    /* ---------- comentarios ---------- */
    if (rota === '/api/comments' && req.method === 'GET') {
        const workId = texto(url.searchParams.get('work_id'), 120);
        if (!workId) return erro('work_id obrigatorio');
        const lista = await db.all(
            `SELECT c.id, c.work_id, c.parent_id, c.conteudo, c.criado_em, c.editado_em,
                    u.id AS user_id, u.username
             FROM comments c JOIN users u ON u.id = c.user_id
             WHERE c.work_id = ?
             ORDER BY c.criado_em ASC LIMIT 300`, [workId]
        );
        return json({ total: lista.length, comentarios: lista });
    }

    if (rota === '/api/comments' && req.method === 'POST') {
        const user = await usuarioDaRequisicao(db, req);
        if (!user) return erro('faça login para comentar', 401);
        let dados;
        try { dados = await lerJson(req); } catch (e) { return erro('corpo invalido'); }
        const workId = texto(dados.work_id, 120);
        const conteudo = texto(dados.conteudo, 2000);
        if (!workId) return erro('work_id obrigatorio');
        if (conteudo.length < 1) return erro('comentario vazio');
        const parentId = dados.parent_id ? Number(dados.parent_id) : null;

        const r = await db.run(
            'INSERT INTO comments (work_id, user_id, parent_id, conteudo) VALUES (?, ?, ?, ?)',
            [workId, user.id, parentId, conteudo]
        );
        const id = r.changes ? Number(r.lastInsertRowid || 0) : 0;
        const novo = id ? await db.first(
            `SELECT c.id, c.work_id, c.parent_id, c.conteudo, c.criado_em, c.editado_em,
                    u.id AS user_id, u.username
             FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`, [id]
        ) : null;
        return json({ ok: true, comentario: novo });
    }

    if (rota.startsWith('/api/comments/') && req.method === 'DELETE') {
        const user = await usuarioDaRequisicao(db, req);
        if (!user) return erro('faça login', 401);
        const id = Number(rota.split('/').pop());
        const c = await db.first('SELECT user_id FROM comments WHERE id = ?', [id]);
        if (!c) return erro('comentario nao encontrado', 404);
        if (c.user_id !== user.id) return erro('voce so pode apagar o proprio comentario', 403);
        await db.run('DELETE FROM comments WHERE id = ?', [id]);
        return json({ ok: true });
    }

    /* ---------- historico ---------- */
    if (rota === '/api/history' && req.method === 'GET') {
        const user = await usuarioDaRequisicao(db, req);
        if (!user) return json({ total: 0, itens: [] });
        const itens = await db.all(
            'SELECT * FROM history WHERE user_id = ? ORDER BY atualizado_em DESC LIMIT 200', [user.id]
        );
        return json({ total: itens.length, itens });
    }

    if (rota === '/api/history' && req.method === 'POST') {
        const user = await usuarioDaRequisicao(db, req);
        if (!user) return erro('faça login', 401);
        let dados;
        try { dados = await lerJson(req); } catch (e) { return erro('corpo invalido'); }
        const workId = texto(dados.work_id, 120);
        if (!workId) return erro('work_id obrigatorio');

        await db.run(
            `INSERT INTO history (user_id, work_id, tipo, titulo, capa, slug, fonte,
                                  capitulo, capitulo_numero, pagina, total_paginas, status, atualizado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(user_id, work_id) DO UPDATE SET
                titulo = excluded.titulo, capa = excluded.capa, slug = excluded.slug,
                fonte = excluded.fonte, capitulo = excluded.capitulo,
                capitulo_numero = excluded.capitulo_numero, pagina = excluded.pagina,
                total_paginas = excluded.total_paginas, status = excluded.status,
                atualizado_em = datetime('now')`,
            [user.id, workId, texto(dados.tipo, 20) || 'manga', texto(dados.titulo, 200),
             texto(dados.capa, 600), texto(dados.slug, 200), texto(dados.fonte, 60),
             texto(dados.capitulo, 120), Number(dados.capitulo_numero) || 0,
             Number(dados.pagina) || 0, Number(dados.total_paginas) || null,
             texto(dados.status, 20) || 'lendo']
        );
        return json({ ok: true });
    }

    if (rota.startsWith('/api/history/') && req.method === 'DELETE') {
        const user = await usuarioDaRequisicao(db, req);
        if (!user) return erro('faça login', 401);
        const workId = decodeURIComponent(rota.split('/').pop());
        await db.run('DELETE FROM history WHERE user_id = ? AND work_id = ?', [user.id, workId]);
        return json({ ok: true });
    }

    return null;
}

module.exports = { tratar, usuarioDaRequisicao, derivar, cookieSessao, cookieLimpo, COOKIE };
