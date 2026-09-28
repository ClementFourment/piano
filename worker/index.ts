import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { LIMITES, lireScore } from "../shared/score";
import type { ScoreDoc, ScoreKind, ScoreMeta, User } from "../shared/api";
import { newSessionToken, sessionId, verifyPassword } from "./auth";

type Env = { DB: D1Database };
type SessionUser = User & { id: number };
type App = { Bindings: Env; Variables: { user: SessionUser | null } };

const SESSION_JOURS = 30;
const ESSAIS_MAX = 10;
const ESSAIS_FENETRE_MS = 15 * 60 * 1000;

const app = new Hono<App>().basePath("/api");

// ── Middlewares ─────────────────────────────────────────────────────────────

// Refuse les requêtes qui modifient des données depuis un autre site (CSRF).
app.use(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Origine refusée." }, 403);
    }
  }
  await next();
});

// Charge l'utilisateur connecté à partir du cookie de session.
app.use(async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, "session", "host");
  if (token) {
    const user = await c.env.DB.prepare(
      `SELECT user.id, user.login, user.firstname, user.lastname FROM session
       JOIN user ON user.id = session.user_id
       WHERE session.id = ? AND session.expires_at > ?`,
    )
      .bind(await sessionId(token), Date.now())
      .first<SessionUser>();
    c.set("user", user);
  }
  await next();
});

const requireAuth: MiddlewareHandler<App> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Connexion requise." }, 401);
  await next();
};

const publicUser = (u: SessionUser): User => ({ login: u.login, firstname: u.firstname, lastname: u.lastname });

// ── Connexion ───────────────────────────────────────────────────────────────

app.get("/me", (c) => {
  const user = c.get("user");
  return c.json({ user: user && publicUser(user) });
});

app.post("/login", async (c) => {
  const db = c.env.DB;
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const now = Date.now();

  await db.prepare("DELETE FROM login_attempt WHERE at < ?").bind(now - ESSAIS_FENETRE_MS).run();
  const essais = await db
    .prepare("SELECT COUNT(*) AS n FROM login_attempt WHERE ip = ?")
    .bind(ip)
    .first<number>("n");
  if ((essais ?? 0) >= ESSAIS_MAX) {
    return c.json({ error: "Trop d'essais. Réessayez dans quelques minutes." }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const login = typeof body?.login === "string" ? body.login.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = await db
    .prepare("SELECT id, login, firstname, lastname, password_hash FROM user WHERE login = ?")
    .bind(login)
    .first<SessionUser & { password_hash: string }>();

  if (!(await verifyPassword(password, user?.password_hash ?? null)) || !user) {
    await db.prepare("INSERT INTO login_attempt (ip, at) VALUES (?, ?)").bind(ip, now).run();
    return c.json({ error: "Identifiants incorrects. Veuillez réessayer." }, 401);
  }

  const token = newSessionToken();
  const expires = now + SESSION_JOURS * 24 * 3600 * 1000;
  await db.batch([
    db.prepare("DELETE FROM session WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(await sessionId(token), user.id, expires),
  ]);
  setCookie(c, "session", token, {
    prefix: "host",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    maxAge: SESSION_JOURS * 24 * 3600,
  });
  return c.json({ user: publicUser(user) });
});

app.post("/logout", async (c) => {
  const token = getCookie(c, "session", "host");
  if (token) {
    await c.env.DB.prepare("DELETE FROM session WHERE id = ?").bind(await sessionId(token)).run();
  }
  deleteCookie(c, "session", { prefix: "host", path: "/", secure: true });
  return c.json({ ok: true });
});

// ── Partitions ──────────────────────────────────────────────────────────────

interface ScoreRow {
  id: string;
  title: string;
  composer: string;
  kind: ScoreKind;
  data: string;
  share_token: string | null;
  updated_at: string;
}

const META = "id, title, composer, kind, share_token, updated_at";

function toMeta(r: Omit<ScoreRow, "data">): ScoreMeta {
  return {
    id: r.id,
    title: r.title,
    composer: r.composer,
    kind: r.kind,
    shareToken: r.share_token,
    updatedAt: r.updated_at.replace(" ", "T") + "Z",
  };
}

function toDoc(r: ScoreRow): ScoreDoc {
  return { ...toMeta(r), data: r.data };
}

function randomToken(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Vérifie le contenu envoyé. Pour une partition éditable, le titre et le compositeur
 * sont repris du JSON ; pour un MEI importé, ils viennent du corps de la requête.
 */
function lireContenu(
  body: Record<string, unknown>,
  kind: ScoreKind,
): { title: string; composer: string; data: string } | string {
  if (kind === "score") {
    const score = lireScore(typeof body.data === "string" ? safeParse(body.data) : body.data);
    if (typeof score === "string") return score;
    const data = JSON.stringify(score);
    if (data.length > LIMITES.donnees) return "Partition trop grande.";
    return { title: score.title, composer: score.composer, data };
  }
  const data = body.data;
  if (typeof data !== "string" || !/<mei[\s>]/.test(data.slice(0, 2000))) return "Fichier MEI invalide.";
  if (new TextEncoder().encode(data).length > LIMITES.donnees) return "Fichier trop gros (1,9 Mo maximum).";
  const texte = (t: unknown, defaut: string) =>
    typeof t === "string" ? t.trim().slice(0, LIMITES.titre) || defaut : defaut;
  return { title: texte(body.title, "Sans titre"), composer: texte(body.composer, ""), data };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

app.get("/scores", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${META} FROM score WHERE owner_id = ? ORDER BY updated_at DESC`)
    .bind(c.get("user")!.id)
    .all<Omit<ScoreRow, "data">>();
  return c.json({ scores: results.map(toMeta) });
});

app.post("/scores", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || (body.kind !== "score" && body.kind !== "mei")) return c.json({ error: "Requête invalide." }, 400);
  const contenu = lireContenu(body, body.kind);
  if (typeof contenu === "string") return c.json({ error: contenu }, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO score (id, owner_id, title, composer, kind, data) VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, title, composer, kind, data, share_token, updated_at`,
  )
    .bind(randomToken(9), c.get("user")!.id, contenu.title, contenu.composer, body.kind, contenu.data)
    .first<ScoreRow>();
  return c.json({ score: toDoc(row!) }, 201);
});

app.get("/scores/:id", requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, title, composer, kind, data, share_token, updated_at FROM score WHERE id = ? AND owner_id = ?",
  )
    .bind(c.req.param("id"), c.get("user")!.id)
    .first<ScoreRow>();
  if (!row) return c.json({ error: "Partition introuvable." }, 404);
  return c.json({ score: toDoc(row) });
});

// Enregistre une partition éditable, ou renomme un MEI importé.
app.put("/scores/:id", requireAuth, async (c) => {
  const db = c.env.DB;
  const owner = c.get("user")!.id;
  const actuelle = await db.prepare("SELECT kind FROM score WHERE id = ? AND owner_id = ?")
    .bind(c.req.param("id"), owner)
    .first<{ kind: ScoreKind }>();
  if (!actuelle) return c.json({ error: "Partition introuvable." }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Requête invalide." }, 400);

  let row: ScoreRow | null;
  if (actuelle.kind === "score") {
    const contenu = lireContenu(body, "score");
    if (typeof contenu === "string") return c.json({ error: contenu }, 400);
    row = await db.prepare(
      `UPDATE score SET title = ?, composer = ?, data = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_id = ? RETURNING id, title, composer, kind, data, share_token, updated_at`,
    )
      .bind(contenu.title, contenu.composer, contenu.data, c.req.param("id"), owner)
      .first<ScoreRow>();
  } else {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, LIMITES.titre) : "";
    if (!title) return c.json({ error: "Le titre est obligatoire." }, 400);
    row = await db.prepare(
      `UPDATE score SET title = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_id = ? RETURNING id, title, composer, kind, data, share_token, updated_at`,
    )
      .bind(title, c.req.param("id"), owner)
      .first<ScoreRow>();
  }
  return c.json({ score: toDoc(row!) });
});

app.delete("/scores/:id", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM score WHERE id = ? AND owner_id = ?")
    .bind(c.req.param("id"), c.get("user")!.id)
    .run();
  return c.json({ ok: true });
});

// Crée (ou retire) le lien de partage en lecture seule.
app.post("/scores/:id/share", requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE score SET share_token = COALESCE(share_token, ?) WHERE id = ? AND owner_id = ? RETURNING ${META}`,
  )
    .bind(randomToken(12), c.req.param("id"), c.get("user")!.id)
    .first<Omit<ScoreRow, "data">>();
  if (!row) return c.json({ error: "Partition introuvable." }, 404);
  return c.json({ score: toMeta(row) });
});

app.delete("/scores/:id/share", requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE score SET share_token = NULL WHERE id = ? AND owner_id = ? RETURNING ${META}`,
  )
    .bind(c.req.param("id"), c.get("user")!.id)
    .first<Omit<ScoreRow, "data">>();
  if (!row) return c.json({ error: "Partition introuvable." }, 404);
  return c.json({ score: toMeta(row) });
});

// Lecture publique d'une partition partagée (sans connexion).
app.get("/shared/:token", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, title, composer, kind, data, share_token, updated_at FROM score WHERE share_token = ?",
  )
    .bind(c.req.param("token"))
    .first<ScoreRow>();
  if (!row) return c.json({ error: "Ce lien de partage n'existe pas ou a été retiré." }, 404);
  // On ne renvoie pas l'id interne : le lien de partage suffit.
  return c.json({ score: { ...toDoc(row), id: "", shareToken: row.share_token } });
});

// ── Erreurs ─────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Introuvable." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Erreur serveur." }, 500);
});

export default app;
