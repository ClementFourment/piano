// Crée un compte, ou change son mot de passe s'il existe déjà (inscription sur invitation).
//
//   PIANO_LOGIN=celine PIANO_PASSWORD=... PIANO_FIRSTNAME=Céline npm run user:add -- --remote
//
// Plusieurs comptes d'un coup, lus en JSON sur l'entrée standard
// ([{ "login", "password", "firstname", "lastname" }, ...]) :
//
//   ... | npm run user:add -- --remote --stdin
//
// Sans --remote, la base locale (.wrangler/) est utilisée.

import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const remote = process.argv.includes("--remote");
const users = process.argv.includes("--stdin")
  ? JSON.parse(readFileSync(0, "utf8"))
  : [
      {
        login: process.env.PIANO_LOGIN,
        password: process.env.PIANO_PASSWORD,
        firstname: process.env.PIANO_FIRSTNAME ?? "",
        lastname: process.env.PIANO_LASTNAME ?? "",
      },
    ];

// Même format que worker/auth.ts
const ITERATIONS = 100_000;
function hash(password) {
  const salt = randomBytes(16);
  const h = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${h.toString("base64")}`;
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sql = users
  .map((u) => {
    if (!u.login || !u.password) {
      console.error("Identifiant et mot de passe obligatoires (PIANO_LOGIN, PIANO_PASSWORD).");
      process.exit(1);
    }
    if (u.password.length < 8) console.warn(`⚠️  Mot de passe de ${u.login} très court.`);
    return (
      `INSERT INTO user (login, password_hash, firstname, lastname) VALUES (${[u.login, hash(u.password), u.firstname ?? "", u.lastname ?? ""].map(q).join(", ")}) ` +
      `ON CONFLICT (login) DO UPDATE SET password_hash = excluded.password_hash, firstname = excluded.firstname, lastname = excluded.lastname;`
    );
  })
  .join("\n");

// Le SQL (qui contient les hash) passe par un fichier temporaire supprimé aussitôt.
const dir = mkdtempSync(join(tmpdir(), "piano-user-"));
const file = join(dir, "user.sql");
try {
  writeFileSync(file, sql);
  const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  execFileSync(process.execPath, [wrangler, "d1", "execute", "piano", remote ? "--remote" : "--local", "--file", file, "-y"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log(`${users.length} compte(s) enregistré(s) : ${users.map((u) => u.login).join(", ")} (${remote ? "en ligne" : "local"}).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
