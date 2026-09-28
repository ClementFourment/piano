-- Schéma initial (septembre 2026)

CREATE TABLE user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login         TEXT NOT NULL UNIQUE,
  -- pbkdf2$<itérations>$<sel base64>$<hash base64>
  password_hash TEXT NOT NULL,
  firstname     TEXT NOT NULL DEFAULT '',
  lastname      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE session (
  -- SHA-256 du jeton envoyé dans le cookie (le jeton lui-même n'est jamais stocké)
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Échecs de connexion récents, pour limiter les essais de mots de passe.
CREATE TABLE login_attempt (
  ip TEXT    NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempt_ip ON login_attempt (ip, at);

CREATE TABLE score (
  id          TEXT    PRIMARY KEY,           -- identifiant aléatoire, sert dans l'URL
  owner_id    INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  composer    TEXT    NOT NULL DEFAULT '',
  -- 'score' : partition éditable (JSON, voir shared/score.ts)
  -- 'mei'   : partition importée (MusicXML, MEI…) convertie en MEI, en lecture seule
  kind        TEXT    NOT NULL CHECK (kind IN ('score', 'mei')),
  data        TEXT    NOT NULL,
  -- NULL = privée ; sinon jeton du lien de partage en lecture seule
  share_token TEXT    UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX score_owner ON score (owner_id, updated_at);
