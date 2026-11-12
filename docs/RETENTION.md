# Rétention des dossiers de release

Code : `src/db/retention.ts` (règle pure + adaptateur) · Tests : `tests/db/retention.test.ts` (16).

## 1. Pourquoi

Un recalcul écrit un **dossier** : une ligne `release_snapshot` plus ses `signal`
(jusqu'à 500). Chaque événement Jira (ticket modifié, lien créé, version touchée)
déclenche un recalcul : **31 dossiers écrits en une journée** sur le site de démo,
pour un seul projet. En face, Forge SQL (`docs/research/R4-sql-llm.md` §3) facture le
stockage au **GB-heure** et plafonne à **1 Gio par installation** (5 s par SELECT,
4 MiB par réponse, aucune clé étrangère ni suppression en cascade). Sans rétention,
`signal` grossit indéfiniment, le quota est atteint et **plus aucune écriture ne
passe**. La rétention supprime les dossiers devenus inutiles, sans jamais toucher à
la traçabilité (SPEC §15).

## 2. La règle exacte

`selectSnapshotsToPrune(snapshots, policy, now, protectedSnapshotIds?)` est **pure**
(aucun import Forge, aucune E/S, `now` injecté) et rend les ids à supprimer, **triés
du plus ancien au plus récent** (identifiant en départage).

| Paramètre | Défaut | Justification |
|---|---|---|
| `keepPerVersion` | **20** | une journée de recalculs (31/jour) tient dans le quota : le diff RI-14 trouve toujours un prédécesseur |
| `keepDailyAfterDays` | **14** | deux semaines de détail par dossier, puis un point par jour |
| `horizonDays` | **180** | six mois d'historique : assez pour un post-mortem, très loin de 1 Gio (un dossier = quelques Kio) |

Dossiers d'une version triés du plus récent au plus ancien (`index`, 0 = dernier).
Première règle qui s'applique gagne :

1. dossier **protégé** (`protected: true` ou dans `protectedSnapshotIds`) → conservé ;
2. `index === 0` (**dernier dossier de la version**) → conservé quoi qu'il arrive :
   cette règle passe **avant** l'horizon, donc un dossier par version survit
   indéfiniment (l'écran doit pouvoir afficher l'avis d'une version vieille d'un an) ;
3. âge > `horizonDays` → **supprimé** ;
4. `index < keepPerVersion` → conservé (quota des plus récents) ;
5. âge ≤ `keepDailyAfterDays` → **supprimé** (quota dépassé dans la fenêtre récente) ;
6. sinon : **un dossier par jour calendrier** (UTC) conservé, le plus récent du jour.

## 3. Ce qui n'est jamais supprimé

- Le **dernier dossier de chaque version** : sans lui `getDossier()` rend `null`,
  l'écran perd l'avis et un **bilan** (`outcome`, clé = `version_id`) n'a plus de
  dossier contre lequel être lu.
- Tout dossier **référencé par une `decision`** (SPEC §15), lu par une requête bornée.
- `waiver`, `decision`, `outcome`, `policy`, `service_map`, `collection` : **aucun**
  DELETE/UPDATE/INSERT (assertion dans les tests) ; les dérogations sont *closes*,
  jamais supprimées. Jamais de suppression de table entière : chaque DELETE porte une
  liste d'ids.
- Un dossier à **date illisible**, et tout dossier quand **`now` est illisible** (une
  horloge cassée n'efface pas l'historique).

## 4. Réglage par l'opérateur

`pruneSnapshots(sql, projectId, policy?, now?, options?)`, `policy` par défaut =
`DEFAULT_RETENTION`. `options` : `maxCandidates` (≤ `MAX_RETENTION_CANDIDATES` = 1000),
`batchSize` (≤ `PRUNE_BATCH_SIZE` = 50), `protectedSnapshotIds`, `clock` (injectable).
`normalizePolicy` borne une politique absurde (négative, `NaN`) au lieu de lever ; une
exposition dans les réglages passerait par `policy.rules_json` (hors périmètre).
`formatRetentionReport(report, locale?)` rend une ligne de **journal technique**, sans
i18n (pas une chaîne utilisateur ; `src/i18n/index.ts` est un fichier partagé) :
`retention prune: scanned=31 pruned=12 protected=2 batches=1 durationMs=48`.

## 5. À câbler

### 5.1 Méthode de store

`pruneSnapshots` prend un `SqlClient` : **pas besoin** de toucher l'interface
`ReleaseStore` (précédent : `src/db/queries.ts` reste hors interface). Dans
`ForgeReleaseStore` (`src/db/repo.ts`) :

```ts
import type { PruneReport, RetentionPolicy } from './retention';
import { DEFAULT_RETENTION, pruneSnapshots } from './retention';

/** Purge les dossiers périmés du projet (docs/RETENTION.md). */
async pruneSnapshots(projectId: string, now: string, policy: RetentionPolicy = DEFAULT_RETENTION): Promise<PruneReport> {
  return pruneSnapshots(this.client, projectId, policy, now);
}
```

### 5.2 Appel dans le déclencheur planifié quotidien

Dans `src/index.ts` → `onScheduled`, une fois par jour (module `daily-outcome`, dont
`scheduledMode(payload)` rend `'outcome'`), avant `runScheduled(...)` ; `projectId` =
le même identifiant que `listOpenVersions` (aujourd'hui `payload.context?.cloudId`).
Budget : 2 SELECT + 2 DELETE par lot de 50 dossiers, loin des 150 req/s et 62,5 s/min.

```ts
import { DEFAULT_RETENTION, formatRetentionReport, pruneSnapshots } from './db/retention';
import { scheduledMode } from './triggers/scheduled';

if (scheduledMode(payload) !== 'hourly') {
  const report = await pruneSnapshots(sql(), payload.context?.cloudId ?? '', DEFAULT_RETENTION, clock.now());
  logger.log('info', formatRetentionReport(report));
}
```

### 5.3 Requêtes SQL exactes attendues (et leurs index)

```sql
-- candidats : 3 colonnes, borné, couvert par idx_snapshot_project (project_id, computed_at)
SELECT id, version_id, computed_at FROM release_snapshot
 WHERE project_id = ? ORDER BY computed_at DESC
 LIMIT 1000;                                    -- sqlLimit(), jamais LIMIT ? (TiDB 1210)
-- dossiers protégés par une décision (decision n'a pas project_id → jointure)
SELECT DISTINCT d.snapshot_id FROM decision d
  JOIN release_snapshot r ON r.id = d.snapshot_id
 WHERE r.project_id = ? LIMIT 1000;
-- par lots de 50 ids : signal D'ABORD, puis le dossier
DELETE FROM signal WHERE snapshot_id IN (?, ?, …);    -- idx_signal_snapshot
DELETE FROM release_snapshot WHERE id IN (?, ?, …);   -- clé primaire
```

**Aucun index nouveau n'est requis.** Optionnel si `decision` grossit (le JOIN la
parcourt sans index sur `snapshot_id`), dans `src/db/schema.ts` (hors périmètre) :
`ALTER TABLE decision ADD INDEX idx_decision_snapshot (snapshot_id);` — sinon passer
les ids à protéger via `options.protectedSnapshotIds`.
