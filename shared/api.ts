// Types échangés entre l'API et l'interface.

export interface User {
  login: string;
  firstname: string;
  lastname: string;
}

/** 'score' = partition éditable (JSON) ; 'mei' = fichier importé, en lecture seule. */
export type ScoreKind = "score" | "mei";

export interface ScoreMeta {
  id: string;
  title: string;
  composer: string;
  kind: ScoreKind;
  /** Jeton du lien de partage, ou null si la partition est privée. */
  shareToken: string | null;
  /** Date ISO de la dernière modification. */
  updatedAt: string;
}

export interface ScoreDoc extends ScoreMeta {
  /** JSON de la partition (kind 'score') ou document MEI (kind 'mei'). */
  data: string;
}
