// Mots de passe (PBKDF2-SHA256) et jetons de session.
// Le format du hash doit rester identique à celui de scripts/make-seed.mjs.

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// Workers limite PBKDF2 à 100 000 itérations.
const ITERATIONS = 100_000;

// Hash factice : on fait le même calcul quand l'identifiant n'existe pas,
// pour ne pas révéler par le temps de réponse quels identifiants existent.
const DUMMY_HASH = `pbkdf2$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [algo, iter, salt, hash] = (stored ?? DUMMY_HASH).split("$");
  if (algo !== "pbkdf2" || !iter || !salt || !hash) return false;
  const expected = unb64(hash);
  const actual = await pbkdf2(password, unb64(salt), Number(iter));
  return stored !== null && actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sessionId(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
