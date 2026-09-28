import type { ScoreDoc, ScoreKind, ScoreMeta, User } from "../shared/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      res.status === 401 && url !== "/api/login"
        ? "Session expirée : reconnectez-vous."
        : (data.error ?? "Erreur réseau, réessayez.");
    throw new ApiError(res.status, message);
  }
  return data as T;
}

type Doc = { score: ScoreDoc };
type Meta = { score: ScoreMeta };

export const api = {
  me: () => request<{ user: User | null }>("GET", "/api/me").then((d) => d.user),
  login: (login: string, password: string) =>
    request<{ user: User }>("POST", "/api/login", { login, password }).then((d) => d.user),
  logout: () => request("POST", "/api/logout"),

  scores: () => request<{ scores: ScoreMeta[] }>("GET", "/api/scores").then((d) => d.scores),
  score: (id: string) => request<Doc>("GET", `/api/scores/${encodeURIComponent(id)}`).then((d) => d.score),
  shared: (token: string) => request<Doc>("GET", `/api/shared/${encodeURIComponent(token)}`).then((d) => d.score),
  create: (kind: ScoreKind, data: string, title?: string, composer?: string) =>
    request<Doc>("POST", "/api/scores", { kind, data, title, composer }).then((d) => d.score),
  save: (id: string, body: { data?: string; title?: string }) =>
    request<Doc>("PUT", `/api/scores/${encodeURIComponent(id)}`, body).then((d) => d.score),
  remove: (id: string) => request("DELETE", `/api/scores/${encodeURIComponent(id)}`),
  share: (id: string) => request<Meta>("POST", `/api/scores/${encodeURIComponent(id)}/share`).then((d) => d.score),
  unshare: (id: string) => request<Meta>("DELETE", `/api/scores/${encodeURIComponent(id)}/share`).then((d) => d.score),
};
