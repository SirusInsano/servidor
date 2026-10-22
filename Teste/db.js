/**
 * Camada de banco: mesma interface para o D1 (Cloudflare) e o node:sqlite (local).
 * O SQL e' o mesmo nos dois - ver schema.sql.
 */
'use strict';

let db = null;
let initPromise = null;

function criarD1(d1) {
    return {
        async exec(sql) { await d1.exec(sql); },
        async all(sql, params) {
            const r = await d1.prepare(sql).bind(...(params || [])).all();
            return r.results || [];
        },
        async first(sql, params) {
            const r = await d1.prepare(sql).bind(...(params || [])).first();
            return r || null;
        },
        async run(sql, params) {
            const r = await d1.prepare(sql).bind(...(params || [])).run();
            return {
                changes: (r.meta && r.meta.changes) || 0,
                lastInsertRowid: (r.meta && r.meta.last_row_id) || 0
            };
        }
    };
}

function criarSqlite(arquivo) {
    // require indireto: o Worker nao tem node:sqlite e o bundler nao deve tentar resolver
    const mod = 'node:' + 'sqlite';
    // eslint-disable-next-line
    const { DatabaseSync } = require(mod);
    const raw = new DatabaseSync(arquivo);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA foreign_keys = ON');
    return {
        async exec(sql) { raw.exec(sql); },
        async all(sql, params) { return raw.prepare(sql).all(...(params || [])); },
        async first(sql, params) { return raw.prepare(sql).get(...(params || [])) || null; },
        async run(sql, params) {
            const r = raw.prepare(sql).run(...(params || []));
            return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        close() { raw.close(); }
    };
}

/** Cria (ou reaproveita) o handle do banco. */
function obter(env) {
    if (db) return db;
    if (env && env.ANIMEWORLD_DB) {
        db = criarD1(env.ANIMEWORLD_DB);
        return db;
    }
    // local: arquivo ./.dados/dragontoons.db (so no Node)
    const fs = require('node:' + 'fs');
    const path = require('node:' + 'path');
    const dir = path.join(__dirname, '.dados');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = criarSqlite(path.join(dir, 'dragontoons.db'));
    return db;
}

/** Roda o schema (idempotente). Só no Node - no Worker o schema e' aplicado
 *  pelo `wrangler d1 execute`. */
function inicializar(env) {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        const d = obter(env);
        if (env && env.ANIMEWORLD_DB) return d;
        const fs = require('node:' + 'fs');
        const path = require('node:' + 'path');
        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await d.exec(sql);
        return d;
    })();
    return initPromise;
}

function fechar() {
    if (db && db.close) db.close();
    db = null;
    initPromise = null;
}

module.exports = { obter, inicializar, fechar };
