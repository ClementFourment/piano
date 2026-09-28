# Partitions

Création, lecture et partage de partitions de piano : piano.clementfourment.fr

- Interface : React + TypeScript (Vite), dans `src/`
- API : Cloudflare Worker + Hono, dans `worker/`
- Base de données : Cloudflare D1 (SQLite), schéma dans `migrations/`
- Modèle de partition et types communs : `shared/`
- Gravure : [Verovio](https://www.verovio.org) (WebAssembly, chargé à l'ouverture d'une partition)
- Son : piano échantillonné [smplr](https://github.com/danigb/smplr) (Splendid Grand Piano)

Tout tourne sur l'offre gratuite de Cloudflare, sans carte bancaire.

## Formats

- Partition éditable : JSON (`shared/score.ts`), convertie en MEI pour l'affichage (`src/mei.ts`).
- Fichiers importés (MusicXML, .mxl, MEI) : convertis en MEI par Verovio, en lecture seule.
- Exports : PDF (impression), MusicXML (partitions éditables, `src/musicxml.ts`), MIDI, MEI, JSON.

## Éditeur

Palette à gauche (`src/components/Palette.tsx`), opérations d'édition pures dans `src/editor/model.ts`
(annuler/rétablir = pile d'états), règles communes au rendu et à l'export dans `src/solfege.ts`.
Enregistrement automatique 1,2 s après la dernière modification. Raccourcis clavier façon MuseScore
(liste dans la palette).

## Développement

```sh
npm install
npm run db:migrate:local
npm run dev                   # http://localhost:5173
npm run check                 # vérification TypeScript
```

## Comptes (sur invitation)

```sh
PIANO_LOGIN=celine PIANO_PASSWORD=... PIANO_FIRSTNAME=Céline npm run user:add -- --remote
```

Même commande pour changer le mot de passe d'un compte existant. Sans `--remote`, c'est la base locale.

## Mise en ligne

```sh
npm run db:migrate:remote     # seulement si une nouvelle migration a été ajoutée
npm run deploy
```
