# R3 — Événements Forge, déclencheurs planifiés et files asynchrones

Recherche documentaire uniquement. Chaque affirmation renvoie à une page officielle Atlassian, avec sa date « Last updated ». Si la doc ne dit rien : **non documenté**. Consulté le 2026-11-11.

## 0. Sources (préfixe URL : `https://developer.atlassian.com`)

| # | Page | URL | Last updated |
|---|---|---|---|
| S1 | Trigger (module) | /platform/forge/manifest-reference/modules/trigger/ | Oct 9, 2026 |
| S2 | Scheduled trigger (module) | /platform/forge/manifest-reference/modules/scheduled-trigger/ | Jun 17, 2026 |
| S3 | Consumer (module) | /platform/forge/manifest-reference/modules/consumer/ | Apr 3, 2026 |
| S4 | Jira events | /platform/forge/events-reference/jira/ | Nov 9, 2026 |
| S5 | Invocation limits | /platform/forge/limits-invocation/ | Sep 1, 2026 |
| S6 | Async events API (« Queues ») | /platform/forge/runtime-reference/async-events-api/ | Sep 1, 2026 |
| S7 | Async events limits | /platform/forge/limits-async-events/ | Feb 26, 2026 |
| S8 | Atlassian app events (filtres) | /platform/forge/events-reference/product_events/ | Aug 6, 2026 |
| S9 | Scheduled trigger limits | /platform/forge/limits-scheduled-trigger/ | Dec 1, 2025 |
| S10 | Scheduled trigger events | /platform/forge/events-reference/scheduled-trigger/ | Nov 11, 2024 |
| S11 | Function (module) | /platform/forge/manifest-reference/modules/function/ | Sep 11, 2026 |
| S12 | Upgrade @forge/events v2 | /platform/forge/runtime-reference/async-events-api-version-2-upgrade/ | Jun 6, 2025 |

Méthode : `web_fetch` pour S1–S5 ; `curl` + `lynx` (rendu texte) pour S6–S12 après un 403 du récupérateur de page (contenu identique à la source). `https://developer.atlassian.com/platform/forge/queues/` renvoie **HTTP 404** : la page officielle sur les files est **S6**.

## 1. Module `trigger` (S1)

**Propriétés (S1)** — `key` string, **requis**, unique dans le manifest, regex `^[a-zA-Z0-9_-]+$` ; `function` string, requis si pas de `endpoint` (référence au module `function`) ; `endpoint` string, requis si pas de `function` (endpoint distant / Forge Remote) ; `events` Array\<string\>, **requis** ; `filter` Filter, optionnel ; `payload` object, optionnel — `payload.include.propertyPaths` : chemins de propriétés d'entité résolues et ajoutées au payload livré (ex. `issue.properties['key'].field`).

**YAML exact (exemple officiel, S1)** :

```yaml
modules:
  trigger:
    - key: issue-updated-trigger-with-ignore-self-and-expression
      function: main
      events:
        - avi:jira:updated:issue
      filter:
        appIsLicensed: true
        ignoreSelf: true
        expression: event.issue.fields?.issueType.name == 'Bug'
        onError: RECEIVE_AND_LOG
function:
  - key: main
    handler: index.run
```

**Adaptation « Rayon d'impact »** (syntaxe identique ; listes `events`/`filter` en style *flow* YAML, équivalent au style bloc ci-dessus) :

```yaml
modules:
  trigger:
    - key: version-lifecycle
      function: main
      events: [avi:jira:created:version, avi:jira:updated:version, avi:jira:released:version,
                avi:jira:unreleased:version, avi:jira:archived:version, avi:jira:unarchived:version,
                avi:jira:moved:version, avi:jira:merged:version, avi:jira:deleted:version]
      filter: { appIsLicensed: true, ignoreSelf: true }
    - key: issue-updated
      function: main
      events: [avi:jira:updated:issue]
      filter: { appIsLicensed: true, ignoreSelf: true }
    - key: issue-links
      function: main
      events: [avi:jira:created:issuelink, avi:jira:deleted:issuelink]
      filter: { appIsLicensed: true, ignoreSelf: true }
```

### 1.1 Filtrage : pas de « predicate », mais `filter.expression`

**La propriété `predicate` n'existe pas dans la doc actuelle** (0 occurrence « predicate » sur S1 et S4). Le filtrage passe par `filter` (S1) : `appIsLicensed` boolean (true → pas d'invocation sur les sites sans licence active) ; `ignoreSelf` boolean (écarte les événements auto-générés, `selfGenerated: true`) ; `expression` string ; `onError` enum (`IGNORE_AND_LOG` défaut, `IGNORE`, `RECEIVE_AND_LOG`, `RECEIVE`) — **`onError` utilisable uniquement avec `expression`**.

Langage (S8) : **sous-ensemble du langage Jira expressions**, *pas* du JSON Predicate. Supporté : accès aux membres statiques, chaînage optionnel `?.`, accès indexé, opérateurs mathématiques et booléens, comparaisons, affectation, fonctions fléchées, littéraux liste/objet, conditionnelles, gestion d'erreur d'exécution, agrégation, JSON, date et heure. Types autorisés : `Error`, `Date`, `CalendarDate`, `List`, `Map`, `String`, `Number`, `Boolean`.

Sémantique (S8) : le payload est sous la variable `event` (type `Map`). L'expression doit s'évaluer en `Boolean` ; **true → l'événement est livré**, false → filtré et abandonné ; tout autre résultat = erreur → filtré. Limites : 10 000 caractères, 50 000 pas d'évaluation ; la CLI analyse l'expression avant déploiement et échoue si elle est trop complexe. Exemple officiel (S8) :

```yaml
filter:
  expression: |
    try {
      return event.issue.fields?.issueType.name == 'Bug';
    } catch (e) {
      throw `Unexpected error: "${e.location}" - ${e.message}.`;
    }
  onError: RECEIVE_AND_LOG
```

Filtrage par propriétés d'entité (S8) : `filter.expression` + `payload.include.propertyPaths`, chemins préfixés par `event.runtime.` dans les expressions (ex. `event.runtime.issue.properties['key'].field`) ; max 100 chemins distincts par app ; valeurs évaluées sur des données de quelques secondes plus anciennes possibles.

### 1.2 Ce que reçoit la fonction (S1)

```js
export async function myTriggerFunction(event, context) {
  // Handle the event
}
```

`event` = payload de l'événement (structure selon S4) ; avec `onError: RECEIVE_AND_LOG` ou `RECEIVE`, il contient en plus les détails de l'échec d'évaluation de l'expression. `context` = `principal` (undefined ou `{ accountId }`), `installContext` (ARI), `workspaceId`, `license`, `installation`. Champs communs à **tous** les payloads Jira (S4) : `timestamp` (epoch ms) et `webhookTraceValue?` (présent seulement si l'app a envoyé l'en-tête `X-Atlassian-Webhook-Trace`).

**Latence de livraison (S1)** : « Events for trigger modules may take up to **3 minutes** to reach your app after the triggering action occurs. » — comportement de plateforme (file interne), pas un défaut de l'app.

### 1.3 Liste EXHAUSTIVE des événements Jira (S4)

**Version (« Project version events ») — 9 :** `avi:jira:created:version`, `avi:jira:updated:version`, `avi:jira:deleted:version`, `avi:jira:released:version`, `avi:jira:unreleased:version`, `avi:jira:archived:version`, `avi:jira:unarchived:version`, `avi:jira:moved:version`, `avi:jira:merged:version`. Scopes : classic `read:jira-work` / granulaire `read:project-version:jira`. Payload commun : `eventType`, `selfGenerated`, `version` (type `Version`), `mergedVersion?` (seulement pour `merged`), `atlassianId?`. Payload de `deleted:version` : + `newAffectsVersion?`, `newFixVersion?`, `customFieldReplacements` (`CustomFieldReplacement[]`).

**Ticket (core issue events) — 6 :** `avi:jira:created:issue`, `avi:jira:updated:issue`, `avi:jira:deleted:issue`, `avi:jira:assigned:issue`, `avi:jira:viewed:issue`, `avi:jira:mentioned:issue`. Scope : `read:jira-work`. Payload `updated:issue` : `eventType`, `selfGenerated`, `customFields?` + `customFieldsStatus` (`INCLUDED`/`OMITTED`) + `skippedCustomFieldIds?`, `jiraEventTypeName?` (ex. `issue_resolved`, `issue_moved`, `issue_generic`), `issue`, `atlassianId?`, `changelog` (`from`/`to`/`fromString`/`toString` ; `fromString`/`toString` renseignés pour `status`, `resolution`, `priority`, `description`, `issuetype`, `versions`, `fixVersions`, `components`, `duedate`, `timeoriginalestimate`, `IssueParentAssociation`, `project`), `associatedUsers?`, `associatedStatuses?`.

**Lien de ticket (issue link events) — 2 :** `avi:jira:created:issuelink`, `avi:jira:deleted:issuelink`. Scope : `read:jira-work`. Payload (identique) : `eventType`, `selfGenerated`, `id` (ID du lien), `sourceIssueId`, `destinationIssueId`, `sourceProjectId`, `destinationProjectId`, `issueLinkType`. Limite (S4) : **seuls les liens internes à une même instance Jira** sont notifiés.

**Tous les `avi:jira:*` de S4 (56)** : `archived:project`, `archived:version`, `assigned:issue`, `changed:configuration`, `commented:issue`, `created:attachment`, `created:component`, `created:field`, `created:filter`, `created:issue`, `created:issuelink`, `created:issuetype`, `created:project`, `created:user`, `created:version`, `created:worklog`, `deleted:attachment`, `deleted:comment`, `deleted:component`, `deleted:field`, `deleted:filter`, `deleted:issue`, `deleted:issuelink`, `deleted:issuetype`, `deleted:project`, `deleted:user`, `deleted:version`, `deleted:worklog`, `failed:expression`, `mentioned:comment`, `mentioned:issue`, `merged:version`, `moved:version`, `released:version`, `restored:field`, `restored:project`, `softdeleted:project`, `timetracking:provider`, `trashed:field`, `unarchived:project`, `unarchived:version`, `unreleased:version`, `updated:component`, `updated:field`, `updated:filter`, `updated:issue`, `updated:issuetype`, `updated:project`, `updated:user`, `updated:version`, `updated:worklog`, `viewed:issue` (préfixe `avi:jira:`). Le type `Version` (champs `id`, `name`, `projectId`…) n'est pas détaillé sur S4 : la « type reference » liée n'est pas résoluble (404 sur les chemins testés).

## 2. Module `scheduledTrigger` (S2)

**Propriétés (S2)** — `key` string, **requis**, regex `^[a-zA-Z0-9_-]+$` ; `function` string, requis si pas de `endpoint` ; `endpoint` string, requis si pas de `function` ; `interval` (`'fiveMinute' | 'hour' | 'day' | 'week'`, **requis**) ; `filter` Filter, optionnel (seul `appIsLicensed` s'applique : ni `ignoreSelf` ni `expression`).

**Intervalles autorisés : `fiveMinute`, `hour`, `day`, `week`.** Pas de cron, pas d'intervalle en minutes libre : le plus fin est `fiveMinute`.

**YAML exact (exemple officiel, S2)** :

```yaml
modules:
  scheduledTrigger:
    - key: example-scheduled-trigger
      function: my-scheduled-function
      interval: hour # Runs hourly
      filter: # Optional. Skip invocations for unlicensed sites.
        appIsLicensed: true
function:
  - key: my-scheduled-function
    handler: index.trigger
    timeoutSeconds: 60 #Optional. Maximum time (in seconds) this function can run when triggered by a schedule or as an async event consumer. Range: 1–900 seconds.
```

**Adaptation « Rayon d'impact »** (rafraîchissement horaire + bilan 72 h ; style flow YAML) :

```yaml
modules:
  scheduledTrigger:
    - key: hourly-refresh
      function: scheduled-hourly
      interval: hour
      filter: { appIsLicensed: true }
    - key: daily-outcome
      function: scheduled-daily
      interval: day
      filter: { appIsLicensed: true }
function:
  - key: scheduled-hourly
    handler: index.hourly
    timeoutSeconds: 600
  - key: scheduled-daily
    handler: index.daily
    timeoutSeconds: 600
```

Le « bilan à 72 h » ne peut pas être un intervalle de 72 h : `interval: day` + test `now - released_at >= 72 h` dans le handler (à corriger dans le SPEC).

**Signature du handler et payload reçu** — deux formulations coexistent dans la doc. Handler simple (S2) :

```js
// index.js
export const trigger = ({ context }) => {
  console.log("Scheduled trigger invoked");
  console.log(context);
  // Add your business logic here
};
```

Payload détaillé (S10) : la plateforme appelle la fonction avec **deux** paramètres — l'objet *request* et l'objet *context* :

```js
{
  context: { cloudId: '4f6d9508-93c9-4c2e-abd7-916c34920012', moduleKey: 'my-scheduled-trigger-example' },
  contextToken: '<JWT opaque>'
}
```
```js
{ principal: undefined, installContext: 'ari:cloud:jira::site/4f275028-9ac9-4a4e-ad97-91667d422097' }
```

La fonction doit renvoyer une réponse HTTP conforme, sinon la plateforme journalise une erreur **424 Failed dependency** (S10) ; 204 = succès, 5xx = erreur.

**Comportement et limites (S2, S9)** — premier déclenchement « peu après la création du déclencheur, environ 5 minutes après le déploiement », puis selon l'intervalle ; **toute modification d'un module `scheduledTrigger` recrée tous les déclencheurs et réinitialise leurs heures de départ** ; exécution **sans contexte utilisateur** (`principal` n'est pas un utilisateur) ; valeur de retour ignorée ; **si la fonction lève une erreur, rien ne se passe et l'invocation n'est pas rejouée** (pas de retry) — elle sera rejouée au prochain tour ; « a small chance of **duplicated invocations** » → à gérer dans le code ; invocations **réparties** sur l'intervalle par installation (ex. H+10 pour l'une, H+20 pour l'autre) : pas de tick synchrone à H+00 ; limites (S9) : **5 modules `scheduledTrigger` max par app**, dont **1 seul** en `fiveMinute` ; timeout : `timeoutSeconds` sur le module `function`, 1–900 s, défaut 55 s (S2, S11).

## 3. Module `consumer` (S3)

**Propriétés (S3)** — `key` string, **requis**, regex `^[a-zA-Z0-9_-]+$` ; `queue` string, **requis** (nom de la file traitée par ce consumer) ; `function` string, requis avec `@forge/events` v2+ (référence au module `function` invoqué quand des événements sont poussés sur la file) ; `resolver` object, requis avec `@forge/events` v1.x — **déprécié** : `{ function, method }` (méthode définie via `resolver.define()`) ; `crossVersion` boolean — propriété **temporaire**, retirée après le 21 novembre 2025.

**Le module `consumer` n'a PAS de `timeoutSeconds`** : le délai maximal se règle sur le module `function` référencé (S6, S11).

**YAML exact (officiel `@forge/events` v2+, recommandé — S3)** :

```yaml
modules:
  consumer:
    - key: my-queue-consumer
      queue: my-queue
      function: myQueueFunction
function:
  - key: myQueueFunction
    handler: index.handler
```

Ancien (`@forge/events` v1.x, déprécié) :

```yaml
modules:
  consumer:
    - key: my-queue-consumer
      queue: my-queue
      resolver: { function: myQueueFunction, method: my-queue-listener }
function:
  - key: myQueueFunction
    handler: index.handler
```

**Adaptation « Rayon d'impact »** :

```yaml
modules:
  consumer:
    - key: recalc-consumer
      queue: rayon-recalc
      function: recalc-consumer-fn
function:
  - key: recalc-consumer-fn
    handler: consumer.handler
    timeoutSeconds: 900
```

**Limites runtime / invocation (S5, S11)** : runtime async events + scheduledTrigger **900 s** (`timeoutSeconds` 1–900 s, défaut 55 s ; uniquement pour les fonctions référencées par un `consumer` ou un `scheduledTrigger`) ; requête sortante unique (async events) **180 s** ; payload d'une invocation **5 Mo** ; 100 log lines / minute d'exécution (arrondi au supérieur, 200 avec `timeoutSeconds: 90`) ; 100 egress requests / minute d'exécution (hors `requestJira` / `requestConfluence`) ; mémoire 1 024 Mo ; disque éphémère 512 Mo.

**Limites async events (S7, par installation)** : **50** events par requête ; **500** events par minute ; **200 Ko** de payload combiné par requête ; **100 Ko** pour un event individuel (fonctions avec `timeout > 55 s`) ; `retryData` **4 Ko** ; **cyclic invocation limit 1000** requêtes de push sur la chaîne (chaque push ≤ 50 events).

> Le « 5 Mo » du SPEC (§14) est la limite de payload **d'une invocation** (S5) ; la limite de payload **d'une file** est **200 Ko par requête** (S7). À corriger dans le SPEC.

**Retries et rétention (S6)** — livraison **« at least once »** : un event en file est garanti livré **au moins une fois** dans la fenêtre de rétention ; fenêtre de rétention **24 h** à partir de la mise en file, extensible à **96 h** (surcharge de la plateforme ou retries sur erreurs plateforme) ; dépassement : erreur **app** → l'event est **abandonné** (dropped), erreur **plateforme** → l'event n'est pas abandonné mais ne sera plus rejoué automatiquement (intervention manuelle Atlassian possible) ; **retries automatiques** dans la fenêtre, **backoff exponentiel** jusqu'à ~**15 minutes** entre deux tentatives ; event « livré avec succès » si l'invocation ne provoque ni demande de retry, ni erreur app, ni erreur plateforme ; **erreurs app** : erreur d'exécution, timeout, out of memory, erreur réseau d'un endpoint distant, permissions insuffisantes, plafond d'invocations atteint ; **erreurs plateforme** : erreur interne 5xx, rate limiting interne ; retry demandé par l'app en retournant un `InvocationError` (`@forge/events`) :

```ts
import { AsyncEvent, InvocationError, InvocationErrorCode } from '@forge/events';

export async function handler(event: AsyncEvent) {
  const response = await callExternalApi(event.body.userName);
  if (response.headers.has('Retry-After')) {
    return new InvocationError({
      retryAfter: parseInt(response.headers.get('Retry-After')),   // max 900 s
      retryReason: InvocationErrorCode.FUNCTION_UPSTREAM_RATE_LIMITED,
      retryData: { userName: event.body.userName }                 // max 4 Ko
    });
  }
}
```

Codes de raison documentés : `FUNCTION_RETRY_REQUEST` (défaut), `FUNCTION_UPSTREAM_RATE_LIMITED`. **DLQ (dead letter queue) : non documenté.** Aucune file de lettres mortes dans S3, S6, S7 ; ce qui existe : abandon de l'event après expiration de la fenêtre de rétention (erreur app) et `queue.getJob(jobId).getStats()` / `.cancel()` (S6).

## 4. API de mise en file : l'appel TypeScript exact

**Ce qu'il faut écrire (et non écrire)** — ❌ `import { Queue } from '@forge/api'` : **la doc ne le dit pas**, la classe `Queue` vient du package **`@forge/events`** (S6) ; ❌ `queue.publish({...})` : **la méthode documentée est `queue.push()`** (S6), aucun `publish` dans la doc ; ✅ `import { Queue } from '@forge/events'` → `new Queue({ key })` → `await queue.push({ body })`.

**Import et instanciation (S6, snippets officiels)** :

```ts
import { Queue } from '@forge/events';

const queue = new Queue({ key: 'queue-name' });
```

Le `key` doit correspondre au `queue:` du module `consumer` dans le manifest. Versioning : `@forge/events` **2.x** pour `body` + `function` ; la 1.x acceptait un payload plat et utilisait `resolver` (S12). La classe `Queue` est générique : `new Queue<IssueEventBody>({ key: 'queue-name' })` avec `interface IssueEventBody { issueKey: string }` permet de typer le body de bout en bout (`queue.push({ body: { issueKey: 'ABC-123' } })` devient alors une erreur de type si le body ne correspond pas — S6).

**Publier un message (S6, snippets officiels)** :

```ts
// Push a single event
await queue.push({ body: { hello: 'world' } });

// Push multiple events
await queue.push([
    { body: { greeting: 'hello' } },
    { body: { farewell: 'goodbye' } }
]);

// Delay the processing of the event by 5 seconds
await queue.push({
    body: { hello: 'world' },
    delayInSeconds: 5
});
```

Signature (S6) :

```ts
export type Body = Record<string, unknown>;
export interface Concurrency {
    key: string;
    limit: number;
}
export interface PushEvent {
    body: Body;
    delayInSeconds?: number;
    concurrency?: Concurrency;
}
export interface PushResult {
  jobId: string;
}

const result: PushResult = await queue.push(PushEvent | PushEvent[]);
```

Règles de forme (S6) : le data doit être dans `body` ; `queue.push({ issueKey: 'ABC-123' })` lève « Event body must be an object. » ; retards **jusqu'à 15 minutes** via `delayInSeconds` ; max 50 events par push, 200 Ko combinés.

**Snippet complet « Rayon d'impact » (trigger → file)** — `src/queue.ts` :

```ts
import { Queue } from '@forge/events';

export interface RecalcRequest {
    versionId: string;
    projectId: string;
    reason: string;          // 'version-event' | 'issue-event' | 'hourly' | '72h-outcome'
}

export const recalcQueue = new Queue<RecalcRequest>({ key: 'rayon-recalc' });
```

et `src/index.ts` (fonction référencée par le module `trigger`) :

```ts
import { recalcQueue } from './queue';

export async function main(event, context) {
  const versionId = event?.version?.id;            // payload avi:jira:*:version
  const projectId = event?.version?.projectId;

  const { jobId } = await recalcQueue.push({
    body: { versionId, projectId, reason: 'version-event' },
    delayInSeconds: 60,                             // laisse le temps de regrouper les événements
    concurrency: { key: `version-${versionId}`, limit: 1 }
  });
  console.log(`pushed job ${jobId}`);
}
```

**Lire le payload côté consumer (S6, snippet officiel)** :

```ts
// src/consumer.ts
import { AsyncEvent } from '@forge/events';

export async function handler(event: AsyncEvent, context: { installContext: string; workspaceId?: string }) {
    // Access the event body
    const data = event.body;
    // Access the invocation context, for example the installation
    const { installContext, workspaceId } = context;
    // Process the event
}
```

**Le payload se lit dans `event.body`** (et **pas** `event.payload` : « There is no payload property; if you read event.payload you get undefined » — S6 ; en v1.x c'était `payload`). Propriétés de `AsyncEvent` (S6) : `body` (`Record<string, unknown>`, les données poussées) ; `jobId` (string, suivi/annulation) ; `eventId` (string, event dans le job) ; `queueName` (string) ; `delayInSeconds` (number | undefined) ; `concurrency` (Concurrency | undefined) ; `retryContext` (RetryContext | undefined, **uniquement peuplé lors d'un retry** — tester l'existence) = `{ retryCount, retryReason, retryData, retentionWindow?: { startTime, remainingTimeMs } }`.

Suivi et annulation d'un job (S6) :

```ts
const { jobId } = await queue.push([{ body: { event: 'event1' } }, { body: { event: 'event2' } }]);
const jobProgress = queue.getJob(jobId);
const { success, inProgress, failed } = await jobProgress.getStats();
await jobProgress.cancel();   // les events non encore démarrés (y compris retries) ne seront pas traités
```

## 5. Déduplication / regroupement : ce que la doc propose

**Aucun mécanisme de déduplication d'un message identique n'est documenté** (S6 ne mentionne que la livraison « at least once »). Réponse : **non documenté : à faire côté app.**

1. **`concurrency: { key, limit }`** (S6) — borne le **nombre d'events traités en parallèle** pour une clé donnée : ce n'est pas une déduplication (les messages en attente ne sont pas fusionnés, ils s'exécutent l'un après l'autre). Compteurs implicites par **installation, pas par file** ; sans `concurrency`, le traitement est non borné, seulement limité par les plafonds d'invocation.
2. **`delayInSeconds`** (S6) — jusqu'à 15 min : décaler la publication pour absorber plusieurs événements proches (agrégation temporelle), sans les fusionner.
3. **Livraison « at least once » + rétention 24–96 h** (S6) → consumer **idempotent** : clé de déduplication côté app (table Forge SQL `recalc_pending` avec `version_id` + `last_pushed_at`, ou `eventId` déjà traité).
4. **`filter.ignoreSelf`** (S1) — évite la boucle événement ↔ écriture de l'app.
5. **Planificateur** (S2) : « a small chance of duplicated invocations » → même exigence d'idempotence.

Conclusion opérationnelle pour « au plus une fois par minute et par version » (SPEC §12) : à implémenter côté app — lire `last_pushed_at` en Forge SQL, ne republier que si `now - last_pushed_at >= 60 s`, et utiliser `concurrency.key = version-<id>` avec `limit: 1` pour éviter les recalculs concurrents sur la même version.

## 6. Écarts relevés avec SPEC.md (§12 et §14)

| Point du SPEC | Doc | Correction |
|---|---|---|
| `trigger` avec « predicate » (dans la demande) | S1 | Pas de `predicate` : `filter` + `filter.expression` (Jira expressions) |
| Événements `created\|updated\|released\|unreleased\|archived\|deleted:version` | S4 | Il manque `unarchived`, `moved`, `merged` (9 au total) |
| « Charge utile : 5 Mo » pour la file | S5 / S7 | 5 Mo = payload d'invocation ; la file est limitée à **200 Ko/requête** |
| `consumer` avec `timeoutSeconds: 900` dans le module | S3 / S11 | `timeoutSeconds` va sur le module **`function`** référencé, pas sur `consumer` |
| « Bilan à 72 h » en `scheduledTrigger` | S2 | Pas d'intervalle 72 h : `interval: day` + test `>= 72 h` dans le handler |
| Mise en file | S6 | `queue.push({ body })` via `@forge/events` (pas `publish`, pas `@forge/api`) |
| Regroupement « au plus un par minute et par version » | S6 | Non fourni par la file → côté app (idempotence + `concurrency`) |
| Contenu du payload de version | S4 | Le type `Version` n'est pas détaillé sur la page events-reference |

## 7. Résumé et pièges (≤ 10 lignes)

1. `Queue` vient de **`@forge/events`** (2.x) et la méthode est **`queue.push({ body })`** — pas `@forge/api`, pas `publish`.
2. Côté consumer on lit **`event.body`** ; `event.payload` n'existe plus en v2 (breaking change v1→v2, S12).
3. `timeoutSeconds` (1–900 s) se déclare sur le **module `function`**, pas sur `consumer` ; 55 s par défaut.
4. La file est plafonnée à **200 Ko / 50 events / 500 events par minute** par installation : le « 5 Mo » du SPEC est une autre limite (payload d'invocation).
5. Filtrage des triggers : **`filter.expression`** (sous-ensemble des *Jira expressions*) — `predicate` et le JSON Predicate n'existent pas dans la doc actuelle.
6. Les événements de version sont **9** : ajouter `unarchived`, `moved`, `merged` à la liste du SPEC.
7. Les triggers ont **jusqu'à 3 minutes de délai de livraison** : l'UI ne doit pas supposer un traitement immédiat.
8. `scheduledTrigger` : intervalles `fiveMinute|hour|day|week` seulement, **max 5 modules dont 1 seul `fiveMinute`**, erreurs **non rejouées**, doublons possibles, distribution dans l'heure.
9. Livraison **« at least once »** + rétention 24 h (96 h) : **déduplication/idempotence à faire côté app** ; aucune DLQ documentée.
10. `concurrency: { key, limit }` borne le parallélisme (portée par installation, pas par file) mais **ne fusionne pas** les messages.
