# R4 — Référence exacte : Forge SQL et Forge LLMs

> Recherche documentaire du **11 novembre 2026** sur `developer.atlassian.com`
> uniquement. Chaque section cite l'URL et le champ « Last updated » de la page.
> Ce qui n'y figure pas est marqué **non documenté** — rien n'est déduit sans
> le dire.

| Page | URL (préfixe `https://developer.atlassian.com/platform/forge/`) | Last updated |
|---|---|---|
| Forge SQL (vue d'ensemble) | `storage-reference/sql/` | Jun 17, 2026 |
| Manage database schemas (DDL) | `storage-reference/sql-api-schema/` | May 15, 2026 |
| Execute SQL operations (DML) | `storage-reference/sql-api/` | Jun 17, 2026 |
| Forge SQL data types | `storage-reference/sql-data-types/` | Jul 14, 2026 |
| Forge SQL query policy | `storage-reference/sql-query-policy/` | Jun 17, 2026 |
| Error handling for Forge SQL | `storage-reference/sql-handling-errors/` | Jun 17, 2026 |
| Tutorial « Add a Forge SQL database » | `storage-reference/sql-tutorial/` | Jul 22, 2026 |
| Forge SQL limits | `limits-sql/` | Dec 1, 2025 |
| Manifest — module `sql` | `manifest-reference/modules/sql/` | Jan 13, 2026 |
| Forge LLMs API (overview) | `runtime-reference/forge-llms-api/` | Jul 23, 2026 |
| Forge LLMs API reference (`@forge/llm`) | `runtime-reference/forge-llms-api-reference/` | Aug 3, 2026 |
| Forge LLMs models | `runtime-reference/forge-llms-models/` | Aug 3, 2026 |
| Forge LLM limits | `limits-llm/` | Sep 30, 2026 |
| Manifest — module `llm` | `manifest-reference/modules/llm/` | Jul 23, 2026 |

---

## 1. API TypeScript exacte de Forge SQL

### 1.1 Correction de la prémisse

`import { sql } from '@forge/api'`, `defineTable`/`Table`, et les opérateurs
`eq`/`gt`/`in`/`and` **n'existent pas** dans la documentation Forge SQL. Ce sont
des noms d'ORM/query-builder sans équivalent documenté ici. Forge SQL est un
**SDK SQL brut** : chaînes SQL (MySQL/ANSI) + paramètres positionnels `?`.

- Paquet : **`@forge/sql`** (pas `@forge/api`) — `npm install @forge/sql`
  *(sql-api, Jun 17 2026)*.
- Imports documentés :
  `import { sql, errorCodes } from '@forge/sql'` (DML + erreurs) ·
  `import sql, { UpdateQueryResponse, Result } from '@forge/sql'` (défaut + types) ·
  `import { migrationRunner } from '@forge/sql'` (DDL).
  *sql-api-schema* montre une fois l'import par défaut de `migrationRunner` mais
  tous ses snippets exécutables utilisent l'import nommé → utiliser l'import nommé.
- `defineTable`/`Table`/`eq`/`gt`/`in`/`and`/`select().from()` : **inexistants**.
  Aucune définition de table en TS ; les tables se créent en DDL via
  `migrationRunner` (§1.3).

### 1.2 Signatures DML

Source : *Execute SQL operations*, Jun 17 2026.

```ts
sql.prepare<DataType>(query: string): SqlStatement<Result<DataType>>;
//   .bindParams(...params): this        // un ? par paramètre, dans l'ordre
//   .execute(): Promise<Result<DataType>>
sql.executeRaw<DataType>(query: string): Promise<Result<DataType>>; // = prepare().execute()
```

```ts
type SqlParameters = any[];
export interface UpdateQueryResponse {
  affectedRows: number; fieldCount: number; info: string;
  insertId: number; serverStatus: number; warningStatus: number;
}
interface Result<DataType = any> {
  rows: DataType extends UpdateQueryResponse ? UpdateQueryResponse : DataType[];
  metadata?: Record<string, any>;
}
```

- Réponses **normalisées en JSON** : `BIGINT`→`string`, `DECIMAL`→`string`,
  `DATE`/`TIME`/`DATETIME`/`TIMESTAMP`→`string`, `BOOLEAN`→`number` (0/1),
  `JSON`→`string`. Conversion dans le code applicatif *(sql-data-types, Jul 14 2026)*.
- Insertion des dates : DATE `YYYY-MM-DD`, TIME `HH:MM:SS[.fraction]`,
  TIMESTAMP `YYYY-MM-DD HH:MM:SS[.fraction]`.
- `bindParams` remplace les `?` **dans l'ordre** : seule protection anti-injection
  documentée, et remplacement imposé des `PREPARE`/`EXECUTE` SQL (interdits).

### 1.3 Signatures DDL

Source : *Manage database schemas*, May 15 2026.

```ts
import { migrationRunner } from '@forge/sql';
migrationRunner.enqueue(operationName: string, ddl: string)  // chaînable, ordre = exécution
               .run(): Promise<...>
migrationRunner.list()   // [{ name, migratedAt }]
```

- **Une seule invocation `migrationRunner` par app.**
- Exécution orchestrée par **async event consumer** (recommandé, ≤ 900 s) ou
  **scheduled trigger** (55 s).
- Chaque DDL **idempotent** : `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `DROP TABLE IF EXISTS`.
- Envelopper `run()` dans un **retry de 60 s** (limite 25 DDL/min = échecs
  transitoires).
- Évolutions **rétro-compatibles** avec tous les schémas/versions d'app en service.

### 1.4 Snippet copiable (schéma + insert + select filtré + update)

Toutes les formes utilisées (`CREATE TABLE … INDEX`, `INSERT`, `SELECT … WHERE …
ORDER BY … LIMIT/OFFSET`, `UPDATE … WHERE`, `bindParams`) sont documentées.

```ts
// src/sql/migration.ts — DDL
import { migrationRunner } from '@forge/sql';

export const CREATE_RELEASE_SNAPSHOT = `
  CREATE TABLE IF NOT EXISTS release_snapshot (
    id VARCHAR(64) NOT NULL PRIMARY KEY, project_id VARCHAR(64) NOT NULL,
    version_id VARCHAR(64) NOT NULL, computed_at TIMESTAMP NOT NULL,
    verdict VARCHAR(24) NOT NULL, confidence VARCHAR(16) NOT NULL,
    coverage_json TEXT, narrative TEXT,
    INDEX idx_snapshot_version (version_id))`;

export const CREATE_SIGNAL = `
  CREATE TABLE IF NOT EXISTS signal (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    snapshot_id VARCHAR(64) NOT NULL,          -- pas de FK : intégrité dans le code
    code VARCHAR(48) NOT NULL, severity VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL, subject_type VARCHAR(24) NOT NULL,
    subject_id VARCHAR(64) NOT NULL, evidence_json TEXT,
    first_seen_at TIMESTAMP NOT NULL,
    INDEX idx_signal_snapshot (snapshot_id), INDEX idx_signal_status (status))`;

const migrations = migrationRunner
  .enqueue('v001_create_release_snapshot', CREATE_RELEASE_SNAPSHOT)
  .enqueue('v002_create_signal', CREATE_SIGNAL);

export const runMigration = async () => {
  const applied = await migrations.run();
  await migrationRunner.list().then((l) =>
    l.forEach((m) => console.log(`${m.name} migrated at ${m.migratedAt.toUTCString()}`)));
  return applied;
};
```

```ts
// src/sql/signals.ts — DML
import { sql, errorCodes, UpdateQueryResponse } from '@forge/sql';

export interface SignalRow {
  id: string; snapshot_id: string; code: string; severity: string;
  status: string; evidence_json: string | null;
  first_seen_at: string;   // TIMESTAMP renvoyé en string
}

// INSERT
export const insertSignal = async (row: SignalRow) => {
  const res = await sql
    .prepare<UpdateQueryResponse>(
      `INSERT INTO signal (id, snapshot_id, code, severity, status,
         subject_type, subject_id, evidence_json, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bindParams(row.id, row.snapshot_id, row.code, row.severity, row.status,
      'issue', 'PAY-131', JSON.stringify({ href: '/browse/PAY-131' }),
      '2026-11-11 09:30:00')
    .execute();
  return res.rows;                       // affectedRows, insertId, ...
};

// SELECT filtré + tri + pagination LIMIT/OFFSET
export const activeSignals = async (snapshotId: string) => {
  const res = await sql
    .prepare<SignalRow>(
      `SELECT id, snapshot_id, code, severity, status, evidence_json, first_seen_at
         FROM signal WHERE snapshot_id = ? AND status = ?
        ORDER BY first_seen_at DESC LIMIT ? OFFSET ?`)
    .bindParams(snapshotId, 'active', 50, 0)
    .execute();
  return res.rows;
};

// UPDATE
export const waiveSignal = async (signalId: string) => {
  try {
    const res = await sql
      .prepare<UpdateQueryResponse>(`UPDATE signal SET status = ? WHERE id = ?`)
      .bindParams('waived', signalId).execute();
    return res.rows.affectedRows;
  } catch (error) {
    if ((error as { code?: string }).code === errorCodes.QUERY_TIMED_OUT) {
      return 0;   // connexion coupée côté HTTP ; la requête peut continuer en base
    }
    throw error;
  }
};
```

### 1.5 Transactions

**Non documenté.** Aucune page ne mentionne `BEGIN`/`COMMIT`/`ROLLBACK` ni une
API de transaction, et deux contraintes s'y opposent (*une seule requête par
appel*, pas de `;` multiple). À traiter comme **non disponible** tant qu'un
prototype ne l'a pas prouvé : concevoir des écritures idempotentes/rejouables.

### 1.6 Codes d'erreur

Source : *Error handling for Forge SQL*, Jun 17 2026.

| Code | Sens |
|---|---|
| `QUERY_TIMED_OUT` | « took more than 2 seconds » → connexion HTTP terminée, requête poursuivie côté base |
| `SQL_EXECUTION_ERROR` | requête incorrecte/non exécutable ; `debug` porte le détail (`ER_PARSE_ERROR` si vide/illisible) |
| `INVALID_SQL_QUERY` | non conforme ANSI SQL |
| `SQL_POLICY_VIOLATION` | fonction/instruction/syntaxe restreinte ; champ `suggestion` fourni |

> ⚠ Incohérence : cette page dit **2 s** pour `QUERY_TIMED_OUT`, alors que
> *limits-sql* et *sql-api* annoncent **5 s** de timeout SELECT. Retenir 5 s ;
> considérer « 2 seconds » comme obsolète.

---

## 2. YAML du module `sql`

Source : `manifest-reference/modules/sql/`, **Jan 13 2026**.

```yaml
modules:
  sql:
    - key: main          # obligatoire, unique, ^[a-zA-Z0-9_-]+$
      engine: mysql      # obligatoire ; seule valeur supportée
```

- **Aucune table, colonne, clé ni index dans le manifest** : tout le schéma vit
  en DDL côté code (`migrationRunner`).
- **Une seule définition** du module par app.
- Ajouter ce module à une app existante ⇒ **montée de version majeure** +
  consentement des administrateurs *(limits-sql, Dec 1 2025)*.

Orchestration des migrations, à prévoir en plus *(sql-api-schema, May 15 2026)* :

```yaml
modules:
  consumer:
    - key: schema-migration-consumer
      queue: schema-migration-queue
      function: runMigration
  trigger:
    - key: app-installed-trigger
      function: enqueueMigration
      events: [avi:forge:installed:app, avi:forge:upgraded:app]
  function:
    - key: runMigration
      handler: index.runMigration
      timeoutSeconds: 900      # 15 min : max d'un async event consumer
    - key: enqueueMigration
      handler: index.enqueueMigration
```

> `avi:forge:upgraded:app` n'est émis **que** pour une montée majeure. Des DDL
> ajoutés en mineure/patch nécessitent un scheduled trigger, sinon la migration
> ne part jamais.

---

## 3. Limites Forge SQL

Source : `limits-sql/`, **Dec 1 2025** (chiffres identiques sur
`storage-reference/sql/`, Jun 17 2026).

**Par installation**

| Ressource | Limite |
|---|---|
| Données stockées | **1 GiB** prod · 256 MiB staging · 128 MiB dev/custom |
| Nombre de tables | **200** |
| DML | **150 req/s** |
| DDL | **25 req/min** |
| Taille par ligne | **6 MiB** |
| Temps d'exécution cumulé (toutes invocations en cours) | **62,5 s/minute** |

**Par requête / réponse**

| Ressource | Limite |
|---|---|
| Mémoire par requête | 16 MiB |
| Temps de requête | 62,5 s/minute |
| Taille requête / réponse | 1 MiB / **4 MiB** |
| Timeout SELECT | **5 s** |
| Timeout INSERT / UPDATE / DELETE | 10 s |
| Timeout DDL | 20 s |

**Contraintes de schéma et de migration**

- **Clés étrangères : non supportées.** `JOIN` possibles, mais `DELETE` **non
  cascadé**.
- **Une seule requête par appel** (pas de `;` multiple).
- Schéma appliqué **après** l'installation (file DDL) : une installation peut
  exister **sans schéma** un moment — tolérer « table absente ».
- **`AUTO_INCREMENT` déconseillé** (points chauds TiDB) : préférer
  `AUTO_RANDOM(S,R)` (borné à ±(2^53)-1 pour rester représentable en JSON) ou
  des UUID en `BINARY(16)`.
- Évolutions **rétro-compatibles** avec les schémas et versions d'app en
  service ; éviter tout changement destructif.
- Type `JSON` : « may not be supported in future versions » → **stocker en
  `TEXT`/`VARCHAR`** et sérialiser dans le code (impacte `coverage_json`,
  `evidence_json`, `rules_json`).
- Le *schema viewer* masque et n'exporte pas les colonnes `TEXT`, `BLOB`,
  `BINARY`, `JSON` → vérification visuelle de `evidence_json`/`narrative`
  impossible.
- Base **TiDB auto-hébergée**, compatible MySQL/ANSI ; éviter les
  fonctionnalités spécifiques TiDB. Sauvegardes périodiques par Forge.
- `CLOB`, `IMAGE`, `XML` : **non supportés** (types non MySQL).

---

## 4. Forge LLMs

### 4.1 YAML du module `llm`

Source : `manifest-reference/modules/llm/`, **Jul 23 2026**.

```yaml
modules:
  llm:
    - key: main-llm     # obligatoire, unique, ^[a-zA-Z0-9_-]+$
      model:            # obligatoire, tableau
        - claude        # seule famille supportée aujourd'hui
```

- **Une seule** définition par app.
- Ajouter le module — ou une **nouvelle famille de modèles** — = **version
  majeure** + revue/approbation administrateur.
- **Aucun scope/permission documenté** pour ce module : le contrôle passe par la
  déclaration du module et le consentement admin. L'app garde le badge
  **Runs on Atlassian**.
- `@forge/llm` sans le module ⇒ lint en échec :
  `LLM package is used but 'llm' module is not defined in the manifest`.

### 4.2 API TypeScript exacte

Source : `runtime-reference/forge-llms-api-reference/`, **Aug 3 2026**.
`asModel` / `model.generateText(...)` **n'existent pas** : l'API est un trio de
fonctions.

```ts
list()         => Promise<ModelListResponse>
chat(Prompt)   => Promise<LlmResponse>
stream(Prompt) => Promise<StreamResponse>   // AsyncIterable<LlmResponse> + close()
```

```ts
type Prompt = LlmRequest & { model: string };
interface LlmRequest {
  messages: Message[];
  temperature?: number;            // jamais avec top_p ; non supporté par certains modèles
  max_completion_tokens?: number;  // ← équivalent « max tokens »
  top_p?: number;
  tools?: Tool[]; tool_choice?: ToolChoice;
}
type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
// { role: "system"|"user"|"assistant"|"tool"; content: Content; ... }
type Content = string | ContentPart[];          // ContentPart = { type: "text"; text: string }
interface LlmResponse { choices: Choice[]; usage?: Usage }
interface Choice { finish_reason: string; index?: number; message: AssistantMessage }
interface Usage { input_tokens?: number; output_tokens?: number; total_tokens?: number }
interface ModelListResponse { models: { model: string; status: "active" | "deprecated" }[] }
```

### 4.3 Snippet copiable (système + user, température, max tokens)

```ts
// src/llm/narrative.ts
import { chat } from '@forge/llm';

const SYSTEM_PROMPT = [
  'You write a 5-to-8 line release verdict narrative.',
  'Every sentence must cite at least one signal code from the input list.',
  'Never mention an issue key or a service that is not in the input.',
  'Reply in the requested language. No preamble, no markdown headings.',
].join(' ');

export interface SignalInput {
  code: string; severity: 'blocking' | 'major' | 'minor';
  subject: string; status: 'active' | 'waived' | 'cleared';
}

export const writeNarrative = async (
  verdict: 'go' | 'go-with-conditions' | 'no-go',
  confidence: 'high' | 'medium' | 'low',
  signals: SignalInput[],
  language: 'en' | 'fr',
) => {
  const response = await chat({
    model: '<model-id issu de list()>',   // ids non figés : lire list(), statut "active"
    temperature: 0.2,
    max_completion_tokens: 800,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [
          `Verdict: ${verdict}`, `Confidence: ${confidence}`,
          `Language: ${language}`, `Signals (JSON): ${JSON.stringify(signals)}`,
        ].join('\n') },
    ],
  });
  const text = response.choices[0]?.message.content;
  return { text: typeof text === 'string' ? text : '', usage: response.usage };
};
```

Streaming : `import { stream } from '@forge/llm'`, puis
`for await (const chunk of response) { … }` et `response.close()`.

### 4.4 Limites Forge LLMs

Source : `limits-llm/`, **Sep 30 2026** — **par installation**.

| Ressource | Limite |
|---|---|
| Requêtes par minute | **100** (tous modèles confondus) |
| Jetons par minute | **500 000** (« a single model can process each minute ») |
| Temps d'inférence | **5 min** (via Async events API avec timeout ≥ 5 min, sinon timeout par défaut) |

| Palier | Contexte (entrée / sortie) |
|---|---|
| Haiku | **200K / 64K** |
| Sonnet | **1M / 128K** |
| Opus | **1M / 128K** |

Modèles *(forge-llms-models, Aug 3 2026)* : **Claude uniquement**, trois paliers
— **Opus** (plus capable, plus lent, plus cher), **Sonnet** (équilibré),
**Haiku** (rapide, bon marché). Les identifiants exacts et leurs dates de retrait
sont dans un tableau **qui ne survit pas à l'extraction texte de la page** : les
lire à l'exécution via `list()` (statut `active`/`deprecated`), jamais codés en
dur. **Texte seul** en entrée et sortie (pas de multimodal).

Autres points *(forge-llms-api, Jul 23 2026)* : `temperature` et `top_p` **jamais
ensemble**, et **aucun des deux** pour les modèles qui ne les supportent pas ·
mêmes **contrôles de modération** que les fonctions IA Atlassian (messages à
risque bloqués) · usage (jetons in/out) **retourné dans chaque réponse** ·
tarification en **crédits** (page `forge-llms-api-pricing/`, non consultée ici).

---

## 5. Confirmé absent ou non documenté

| Élément | État | Source |
|---|---|---|
| Clés étrangères / cascade de suppression | **Non supportées** (`JOIN` OK, `DELETE` non cascadé) | limits-sql Dec 1 25 ; sql Jun 17 26 |
| Jointures (`JOIN`) | **Supportées** | idem |
| Transactions (`BEGIN`/`COMMIT`/`ROLLBACK`) | **Non documenté** | — |
| Pagination (curseur, `nextPageToken`) | **Non documentée** ; `LIMIT`/`OFFSET` en SQL — *inférence, non testée* | sql-api Jun 17 26 |
| Query builder TS (`defineTable`, `Table`, `eq`, `gt`, `in`, `and`) | **Inexistant** | — |
| Tables/index dans le manifest | **Inexistants** (DDL uniquement) | modules/sql Jan 13 26 |
| `PREPARE`/`EXECUTE`/`DEALLOCATE` SQL, `USE`, tables cross-installation | **Interdits** (utiliser `sql.prepare`) | sql-query-policy Jun 17 26 |
| `SET` autre que `SET @var=…` (`autocommit`, `sql_mode`, `GLOBAL`…) | **Interdits** | idem |
| `SHOW` autre que TABLES/COLUMNS/INDEXES/KEYS | **Interdits** | idem |
| `SLEEP`, `BENCHMARK`, `AES_ENCRYPT/DECRYPT`, `SHA2`, `COMPRESS`, `LOCK TABLES` | **Audit déclenché** → rejet ou bridage possible | idem |
| Types `CLOB`, `IMAGE`, `XML` | **Non supportés** | sql-data-types Jul 14 26 |
| Type `JSON` | Supporté mais **déconseillé** (retrait possible) | idem |
| Forge SQL / LLMs en Atlassian Government Cloud | **Non supportés** | limits-sql / limits-llm |
| Scopes OAuth du module `llm` | **Non documentés** (aucun scope à déclarer) | modules/llm Jul 23 26 |
| `asModel()` / `model.generateText()` | **Inexistants** ; API = `chat()`/`stream()`/`list()` | llms-api-reference Aug 3 26 |

---

## 6. Pièges pour Rayon d'impact

1. **Pas d'ORM** : SQL écrit à la main, `?` + `bindParams` uniquement. Aucun
   typage automatique des colonnes : les interfaces TS sont déclaratives, non
   vérifiées.
2. **Le schéma n'existe pas à l'installation** : file DDL + orchestration
   obligatoires, et l'app doit répondre proprement si la table manque encore.
3. **Les JSON reviennent en `string`** et le type `JSON` est en sursis :
   `coverage_json`, `evidence_json`, `rules_json` en `TEXT` + `JSON.parse` sous
   `try/catch`.
4. **Dates en `string`** (`'2026-11-11 09:30:00'`) : parsing obligatoire à la
   lecture. Le tutoriel montre un `moment().format('YYYY-MM-DDTHH:mm:ss.SSS')`
   qui contredit le format annoncé : suivre le tableau de types, pas l'exemple.
5. **`BIGINT` en `string`** : identifiants en `VARCHAR(64)` (UUID) pour éviter
   toute la gymnastique `BigInt`.
6. **5 s par SELECT et 62,5 s cumulées par minute** (budget partagé par toutes
   les invocations simultanées) : découper un dossier de 200 tickets en petites
   requêtes, agréger côté code.
7. **Pas de transaction documentée** : opérations idempotentes et rejouables
   (`id` fourni par l'app, `UPDATE` ciblé), jamais de « lire puis écrire » non
   protégé.
8. **Ajouter `sql` ou `llm` = version majeure** + consentement admin : déclarer
   les deux modules dès le premier manifest soumis.
9. **LLM : 100 req/min, 500 000 jetons/min par modèle** : étaler les recalculs
   massifs (async events) ; une seule requête de synthèse par dossier.
   `temperature` et `top_p` jamais ensemble.
10. **Ids de modèle non figés** : passer par `list()` et filtrer
    `status === 'active'` au lieu de coder en dur un identifiant Claude dont la
    date de retrait est annoncée.
