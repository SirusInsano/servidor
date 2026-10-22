-- =========================================================
--  AnimeWorld - schema (usado no D1 e no node:sqlite local)
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    email       TEXT    NOT NULL UNIQUE,
    senha_hash  TEXT    NOT NULL,
    senha_salt  TEXT    NOT NULL,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now')),
    ultimo_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    criado_em  TEXT    NOT NULL DEFAULT (datetime('now')),
    expira_em  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expira ON sessions(expira_em);

CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id     TEXT    NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    conteudo    TEXT    NOT NULL,
    criado_em   TEXT    NOT NULL DEFAULT (datetime('now')),
    editado_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);

CREATE TABLE IF NOT EXISTS history (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id         TEXT    NOT NULL,
    tipo            TEXT    NOT NULL DEFAULT 'manga',
    titulo          TEXT,
    capa            TEXT,
    slug            TEXT,
    fonte           TEXT,
    capitulo        TEXT,
    capitulo_numero REAL,
    pagina          INTEGER NOT NULL DEFAULT 0,
    total_paginas   INTEGER,
    status          TEXT    NOT NULL DEFAULT 'lendo',
    atualizado_em   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, work_id)
);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, atualizado_em DESC);
