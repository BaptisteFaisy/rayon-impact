# R5 — Scopes OAuth Forge et API d'accès aux données

Recherche documentaire uniquement. Chaque affirmation renvoie à une page officielle Atlassian, avec sa date « Last updated ». Si la doc ne dit rien : **non documenté**. Consulté le 2026-11-11.

## 0. Sources

| # | Page | URL (préfixe `https://developer.atlassian.com` ou `https://support.atlassian.com`) | Last updated |
|---|---|---|---|
| S1 | Fetch API (liste des endpoints Atlassian) | /platform/forge/runtime-reference/fetch-api/ | Nov 8, 2024 |
| S2 | requestJira | /platform/forge/apis-reference/fetch-api-product.requestjira/ | Nov 8, 2024 |
| S3 | requestConfluence | /platform/forge/apis-reference/fetch-api-product.requestconfluence/ | Feb 13, 2026 |
| S4 | requestTeamworkGraph (bridge frontend) | /platform/forge/apis-reference/ui-api-bridge/requestTeamworkGraph/ | Nov 10, 2026 |
| S5 | Authorize API | /platform/forge/runtime-reference/authorize-api/ | Nov 8, 2024 |
| S6 | Permissions du manifest | /platform/forge/manifest-reference/permissions/ | Sep 16, 2026 |
| S7 | Sécurité Forge (impersonation) | /platform/forge/security/ | Jul 27, 2026 |
| S8 | Scopes Jira (3LO / Forge) | /platform/forge/manifest-reference/scopes-product-jira/ | Nov 1, 2024 |
| S9 | Scopes Jira Software | /platform/forge/manifest-reference/scopes-product-jsw/ | Nov 1, 2024 |
| S10 | Scopes JSM | /platform/forge/manifest-reference/scopes-product-jsm/ | Nov 1, 2024 |
| S11 | Scopes Confluence | /platform/forge/manifest-reference/scopes-product-confluence/ | Nov 1, 2024 |
| S12 | TWG — Appeler l'API | /platform/teamwork-graph/call-the-teamwork-graph-api/ | Feb 11, 2026 |
| S13 | TWG — Scopes | /platform/teamwork-graph/scopes/ | Sep 15, 2026 |
| S14 | TWG — Types de relations | /platform/teamwork-graph/api-reference/relationship-types/overview/ | Nov 2, 2026 |
| S15 | TWG — Curated queries | /platform/teamwork-graph/curated-queries/ | Sep 25, 2026 |
| S16 | TWG — Persisted Cypher queries | /platform/teamwork-graph/persisted-cypher-queries/ | Sep 15, 2026 |
| S17 | TWG — Limites | /platform/teamwork-graph/limitations-and-considerations/ | Sep 18, 2025 |
| S18 | REST Jira — Versions de projet | /cloud/jira/platform/rest/v3/api-group-project-versions/ | — (aucune date affichée) |
| S19 | REST Jira — Issues | /cloud/jira/platform/rest/v3/api-group-issues/ | — |
| S20 | REST Jira — Issue search | /cloud/jira/platform/rest/v3/api-group-issue-search/ | — |
| S21 | REST Jira — Comments | /cloud/jira/platform/rest/v3/api-group-issue-comments/ | — |
| S22 | REST Jira — Issue remote links | /cloud/jira/platform/rest/v3/api-group-issue-remote-links/ | — |
| S23 | REST Jira — Issue links | /cloud/jira/platform/rest/v3/api-group-issue-links/ | — |
| S24 | REST Jira — Permissions | /cloud/jira/platform/rest/v3/api-group-permissions/ | — |
| S25 | REST Jira Software — Development Information | /cloud/jira/software/rest/api-group-development-information/ | — |
| S26 | REST JSM — Intro | /cloud/jira/service-desk/rest/intro/ | — |
| S27 | REST JSM — Assets | /cloud/jira/service-desk/rest/api-group-assets/ | — |
| S28 | REST Confluence v2 — Pages | /cloud/confluence/rest/v2/api-group-page/ | — |
| S29 | Support — JQL developer status | /jira-software-cloud/docs/jql-developer-status/ | — |
| S30 | Support — JSM : services et incidents | /jira-service-management-cloud/docs/how-services-work-with-incidents/ | — |
| S31 | Support — JSM : schémas Assets et incidents | /jira-service-management-cloud/docs/connect-assets-schemas-with-incidents/ | — |
| S32 | Typages `@forge/api` 8.5.0 (paquet npm) | https://registry.npmjs.org/@forge/api | version 8.5.0 |

Méthode : `web_fetch` pour S12–S17, S4, S5 (contenu complet) ; `curl` + extraction texte pour les autres (les pages REST sont volumineuses et `web_fetch` tronque). S32 : paquet npm `@forge/api@8.5.0` dépaqueté localement, lecture de `package/out/index.d.ts`.

## 1. Scopes — chaînes exactes, par besoin

Règle générale (S8, S9, S10, S11) : *« Jira permissions also control access to data and aren't overridden by scopes »* — un scope n'ouvre rien que les permissions du produit n'ouvrent pas. Recommandation Atlassian : **scopes classiques** quand ils existent ; **plafond 50 scopes** par app (S8, S13).

### 1.1 Jira — tickets, versions, liens, historique

| Besoin | Scope classique | Scope granulaire équivalent |
|---|---|---|
| Lire tickets, recherche JQL, versions, liens, champs, changelog | `read:jira-work` | `read:issue:jira`, `read:issue-details:jira`, `read:issue-meta:jira`, `read:issue.changelog:jira`, `read:issue.remote-link:jira`, `read:issue-link:jira`, `read:project-version:jira`, `read:project:jira`, `read:field:jira`, `read:status:jira` |
| Lire les profils utilisateurs | `read:jira-user` | `read:user:jira` |
| Compter / vérifier des JQL | — | `read:jql:jira`, `validate:jql:jira` |

### 1.2 Écrire un commentaire

`write:jira-work` (classique, S8) ou granulaire `write:comment:jira` (+ `read:comment:jira` pour lire la réponse) — S21 : POST /rest/api/3/issue/{issueIdOrKey}/comment exige `write:jira-work` (RECOMMANDÉ) ; la liste granulaire affichée est tronquée (« Show more ») mais contient bien `write:comment:jira`.

### 1.3 Information de développement (Jira Software)

Jira Software n'a **pas** de scopes classiques (S9) ; tout est granulaire :

- `read:dev-info:jira` — « Allows the app to read development information »
- `read:build-info:jira` — information de build
- `read:remote-link-info:jira` — information de lien distant
- `read:deployment-info:jira`, `read:feature-flag-info:jira`
- `read:source-code:jira-software` — « View repositories and check if data exists for the supplied properties »
- `read:build:jira-software`, `read:deployment:jira-software`, `read:remote-link:jira-software`, `read:feature-flag:jira-software`
- `read:board-scope:jira-software` (tableaux, versions), `read:sprint:jira-software`, `read:epic:jira-software`, `read:issue:jira-software`

⚠️ Ces scopes servent surtout aux API *DevOps fournisseur* (S25). La lecture des PR/commits/builds d'un ticket par une app **consommatrice** passe de préférence par le Teamwork Graph (§6) ou le JQL `development[…]` (§3).

### 1.4 JSM — incidents et services

- `read:servicedesk-request` (classique, S10) : données de demandes + « Read service desk and request types ». C'est le scope exigé par `GET /rest/servicedeskapi/assets/workspace` (S27).
- `read:jira-work` (S8) : les incidents JSM sont des tickets Jira (type « Incident ») → lus via l'API Jira.
- Granulaires JSM : `read:request:jira-service-management`, `read:servicedesk:jira-service-management`, `read:queue:jira-service-management`, `read:knowledgebase:jira-service-management`, `read:product:jira-service-management`.
- Assets (pour lire les objets « service ») : `read:cmdb-object:jira`, `read:cmdb-schema:jira`, `read:cmdb-type:jira`, `read:cmdb-attribute:jira` (S10).

### 1.5 Confluence — contenu des pages

- Classiques (S11) : `read:confluence-content.summary` (résumé sans expansions), `read:confluence-content.all` (corps de la page inclus), `read:confluence-space.summary`, `search:confluence`.
- Granulaires : `read:page:confluence` (**c'est celui qu'exige GET /wiki/api/v2/pages/{id}**, S28), `read:content-details:confluence`, `read:content:confluence`, `read:space-details:confluence`, `read:content.metadata:confluence`, `read:relation:confluence`.

### 1.6 Teamwork Graph — un scope par type d'objet

Format exact (S13) : `read:graph:<objet>:<produit>`. **Tous les scopes du graphe sont en lecture seule** ; pas d'écriture via cette API.

Jira : `read:graph:issue:jira` (JiraWorkItem), `read:graph:issue-comment:jira`, `read:graph:issue-status:jira`, `read:graph:issue-remote-link:jira`, `read:graph:issue-worklog:jira`, `read:graph:project:jira` (JiraSpace), `read:graph:board:jira`, `read:graph:sprint:jira`, `read:graph:version:jira` (JiraVersion).

Confluence : `read:graph:page:confluence`, `read:graph:blogpost:confluence`, `read:graph:comment:confluence`, `read:graph:database:confluence`, `read:graph:folder:confluence`, `read:graph:space:confluence`, `read:graph:whiteboard:confluence`.

Atlassian : `read:graph:user:atlassian`, `read:graph:team:atlassian`, `read:graph:team-type:atlassian`, `read:graph:goal:atlassian`, `read:graph:goal-update:atlassian`, `read:graph:project:atlassian`, `read:graph:project-update:atlassian`, `read:graph:tag:atlassian`, `read:graph:comment:atlassian`, `read:graph:assets-object:atlassian`.

Loom : `read:graph:video:loom`, `read:graph:comment:loom`, `read:graph:meeting:loom`, `read:graph:meeting-recurrence:loom`, `read:graph:space:loom`.

Compass / Opsgenie / Focus / Talent : `read:graph:component:compass`, `read:graph:component-link:compass`, `read:graph:scorecard:compass`, `read:graph:team:opsgenie`, `read:graph:focus-area:focus`, `read:graph:focus-area-status-update:focus`, `read:graph:change-proposal:focus`, `read:graph:position:talent`, `read:graph:worker:talent`.

Outils connectés (GitHub, Bitbucket, Google Drive…) : `read:graph:work-item:external`, `read:graph:document:external`, `read:graph:space:external`, `read:graph:project:external`, `read:graph:comment:external`, `read:graph:message:external`, `read:graph:conversation:external`, `read:graph:repository:external`, `read:graph:branch:external`, `read:graph:commit:external`, `read:graph:pull-request:external`, `read:graph:build:external`, `read:graph:deployment:external`, `read:graph:feature-flag:external`, `read:graph:service:external`, `read:graph:vulnerability:external`, `read:graph:design:external`, `read:graph:video:external`, `read:graph:calendar-event:external`, `read:graph:dashboard:external`, `read:graph:data-table:external`, `read:graph:remote-link:external`, `read:graph:deal:external`, `read:graph:customer-org:external`, `read:graph:customer-org-category:external`, `read:graph:customer-contact:external`, `read:graph:organisation:external`, `read:graph:position:external`, `read:graph:worker:external`.

Pièges scopes graphe (S13) :
- Un scope manquant **ne produit aucune erreur** : l'objet est omis silencieusement ; un scope manquant sur un objet **intermédiaire** vide tout le résultat d'une traversée.
- Les scopes sont appliqués **par-dessus** le filtrage par permissions : l'utilisateur de la requête ne voit que ce qu'il voit déjà dans le produit.
- Changement de scope : ~1 minute de propagation ; requête enregistrée = non exécutable tout de suite (`QUERY_NOT_FOUND`).
- Installation d'une app avec des scopes TWG exige des **permissions d'administrateur d'organisation** (S17).

### 1.7 Bloc `manifest.yml` proposé (17 scopes, sous le plafond de 50)

```yaml
permissions:
  scopes:
    # Jira — tickets, versions, liens, historique, recherche
    - 'read:jira-work'                 # classique (S8) : tickets, JQL, versions, issuelinks, changelog
    - 'write:jira-work'                # commentaire (S8/S21)
    # Jira Software — information de développement
    - 'read:dev-info:jira'             # (S9)
    # JSM — service desk + Assets (services)
    - 'read:servicedesk-request'       # (S10/S27)
    # Confluence — corps des pages
    - 'read:confluence-content.all'    # (S11) — ou granulaire 'read:page:confluence'
    # Teamwork Graph — un scope par type d'objet (S13)
    - 'read:graph:issue:jira'          # tickets
    - 'read:graph:version:jira'        # versions
    - 'read:graph:project:jira'        # espaces Jira
    - 'read:graph:issue-remote-link:jira'
    - 'read:graph:user:atlassian'
    - 'read:graph:team:atlassian'
    - 'read:graph:commit:external'     # commits
    - 'read:graph:pull-request:external'
    - 'read:graph:build:external'
    - 'read:graph:component:compass'
    - 'read:graph:service:external'    # services (incidents JSM)
    - 'read:graph:page:confluence'
```

`forge lint --fix` peut ajouter les scopes automatiquement ; `forge install --upgrade` est requis après modification (S8).

## 2. Appels TypeScript exacts

### 2.1 Ce qui existe vraiment dans `@forge/api` (S1, S4, S32)

La page Fetch API (S1) ne liste que **quatre** points d'entrée Atlassian : `requestBitbucket`, `requestConfluence`, `requestJira`, `requestGraph` (passerelle GraphQL pour Compass et `api.atlassian.com/graphql`).

Les typages de `@forge/api@8.5.0` (S32) confirment :

```ts
export type RequestProductMethod = (url: Route, init?: RequestInit) => Promise<APIResponse>;
export interface RequestProductMethods { requestJira; requestConfluence; requestBitbucket }
export interface TeamworkGraphFetchMethods {
  requestTeamworkGraph: (query: string, variables?: any, operationName?: string,
                         extensions?: any, headers?: Record<string, any>) => Promise<APIResponse>;
}
type AsUserFetchMethods = RequestProductMethods & GraphQLFetchMethods & … & TeamworkGraphFetchMethods;
type AsAppFetchMethods  = RequestProductMethods & GraphQLFetchMethods & … ;   // ← PAS de TeamworkGraphFetchMethods
```

Conséquences :
- **Il n'existe pas de `requestJiraServiceManagement`** dans `@forge/api` → les endpoints JSM (`/rest/servicedeskapi/…`) passent par `requestJira`.
- **Il n'existe pas de `asApp().requestTeamworkGraph`** : le graphe ne s'appelle qu'au nom d'un utilisateur. S4 le dit explicitement : « Calls always run as the current user; Forge apps can't call the Teamwork Graph API as the app. »

### 2.2 `requestJira` — app, utilisateur, et impersonation (S2)

```ts
import api, { route } from '@forge/api';

// Au nom de l'app (utilisateur « app user »)
const versions = await api.asApp().requestJira(route`/rest/api/3/project/${projectKey}/versions`);

// Au nom de l'utilisateur courant
const me = await api.asUser().requestJira(route`/rest/api/3/myself`);

// Au nom d'un autre utilisateur (impersonation hors ligne)
const res = await api.asUser(accountId).requestJira(route`/rest/api/3/issue/${issueKey}`, {
  headers: { Accept: 'application/json' },
});
```

Points durs (S2, S7) :
- Le chemin **doit** passer par le gabarit `route` (protection path traversal + encodage) ; `assumeTrustedRoute` existe mais « only if absolutely needed ».
- `asUser(accountId)` exige `allowImpersonation: true` sur les scopes concernés, dans la forme « map » du manifest (S6) ; et le manifest doit déclarer `permissions.scopes` comme objet :
  ```yaml
  permissions:
    scopes:
      read:jira-work:
        allowImpersonation: true
  ```
- Restrictions d'impersonation (S7) : pas de `read:me`-type scopes, pas d'un utilisateur d'une autre app, pas d'utilisateur désactivé, pas d'anonyme.
- `asUser()` (sans argument) ne s'utilise que dans les modules compatibles UI kit ; sinon le contexte utilisateur n'est pas disponible.

### 2.3 `requestConfluence` (S3)

```ts
const page = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
  headers: { Accept: 'application/json' },
});
const body = await page.json();
```

### 2.4 JSM — via `requestJira` (S26, S32)

S26 : « The URIs for Forge app REST API calls have this structure: `https://<site-url>/rest/servicedeskapi/<resource-name>` ».

```ts
// Espaces de travail Assets (services JSM) — scope read:servicedesk-request
const ws = await api.asApp().requestJira(route`/rest/servicedeskapi/assets/workspace`);
const { values } = await ws.json();   // [{ workspaceId: '1060ba0e-…' }]
```

Les groupes d'endpoints JSM documentés (S26) sont : **Assets, Customer, Info, Knowledgebase, Organization, Request, Requesttype, Servicedesk, Other operations**. Il n'existe **aucun groupe « incidents »** : les incidents JSM sont des tickets Jira (type « Incident ») et se lisent via l'API Jira (§4.6).

### 2.5 `requestTeamworkGraph` — backend (S4, S12, S32)

```ts
// Backend : toujours api.asUser() (jamais asApp)
const res = await api.asUser().requestTeamworkGraph(
  `query Impact($queryKey: String!, $queryParams: CypherRequestParams) {
     customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
       edges { node { columns { key value { __typename
         ... on CypherQueryResultListNode { nodes { id data { __typename
           ... on ExternalCommit { id } } } } } } } }
   }`,
  { queryKey: 'b2c1a0f4-…', queryParams: { id: issueAri } },
);
const json = await res.json();
```

- Frontend (Custom UI) : `import { requestTeamworkGraph } from '@forge/bridge'` → renvoie `{ data?, errors? }` (S4).
- Test de connectivité (S12) : `query { echo(myString: "Hello World!") }`.

### 2.6 Forme de la requête TWG : curated ou persisted Cypher (S12, S15, S16)

- **Curated queries** (S15) : champs GraphQL typés du type racine `Query`, aucun enregistrement, **plafond `first: 25`** (25 par défaut). Catalogue utile à l'app :
  `jiraWorkItemLinkedExternalPullRequests(id: ID!)`, `jiraWorkItemLinkedExternalDeployments(id: ID!)`, `jiraWorkItemGoals(id: ID!)`, `jiraWorkItemComments(id: ID!, since: String! = "P30D")`, `jiraSpaceWorkItems(spaceAri: ID!)`, `atlassianTeamsBySpace(spaceAri: ID!)`, `atlassianTeamMembers(teamAri: ID!)`, `spacesByAtlassianTeam(teamAri: ID!)`, `atlassianUserPullRequests(userId: ID!, roles: [AtlassianUserPullRequestRole!], since: String)`.
  ⚠️ **Aucun champ curaté ne couvre ticket→commit, ticket→composant Compass, incident→service** : il faut une requête Cypher enregistrée.
- **Persisted Cypher queries** (S16) : enregistrement **une fois** (script de setup), exécution à chaque appel.

```bash
# Enregistrement (idempotent : 201 à la création, 200 si déjà enregistré)
curl -X POST "https://<site>.atlassian.net/gateway/api/twg/cypher-queries" \
  -H 'Content-Type: application/json' \
  -d '{
    "appId": "ari:cloud:ecosystem::app/<app-id>",
    "name": "commits-of-issue",
    "cypher": "MATCH (item:JiraWorkItem {ari: $id})-[:jira_work_item_links_external_commit]->(commit:ExternalCommit) RETURN commit",
    "paramsSchema": [ { "name": "id", "type": "ARI", "required": true } ]
  }'
# → 201 { "queryKey": "b2c1a0f4-…", "version": 1, "contentHash": "9f2b…", "status": "active" }
```

- Exécution (S16) : champ GraphQL `customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25)`.
- `paramsSchema` types : `ARI`, `STRING`, `INTEGER`, `FLOAT`, `BOOLEAN`, `JSON`.
- Seule l'app propriétaire de la requête peut l'exécuter ; ~1 minute de propagation après enregistrement (`QUERY_NOT_FOUND` si trop tôt).
- **Le Cypher brut (`cypherQuery`) est fermé aux nouvelles apps** (S12, S16) : passer par `customQuery` + `queryKey`.

### 2.7 Exemple complet de collecte (Jira + Confluence + graphe)

```ts
// Tickets d'une version
const search = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    jql: `project = "${projectKey}" AND fixVersion = "${versionName}"`,
    fields: ['summary', 'status', 'issuetype', 'fixVersion', 'issuelinks', 'parent', 'created'],
    maxResults: 100,
  }),
});
const { issues, nextPageToken } = await search.json();   // itérer sur nextPageToken
```

## 3. JQL « development » — syntaxe exacte (S29)

Page officielle : « JQL developer status » (support.atlassian.com, aucune date « Last updated » affichée).

> « The content on this page applies only if you have Jira Cloud connected to a build tool. »

**Champs documentés :**

| Alias | Valeurs |
|---|---|
| `development[pullrequests]` | `.all` ou `.open` |
| `development[commits]` | `.all` |
| `development[reviews]` | `.all` ou `.open` |
| `development[builds]` | `.failing` (comparaison numérique) |

Exemples exacts de la page :

```
development[builds].failing > 2
deploymentEnvironmentType ~ "production" AND development[pullrequests].open
buildState ~ "failed"
buildState ~ "FAILED" AND development[pullrequests].open
```

Autres alias de la même page : `flagEnabledRollout`, `flagDisabledRollout`, `flagEnabled`, `flagName`, `flagKey`, `deploymentEnvironmentName`, `deploymentEnvironmentType`, `deploymentState`, `deploymentName`, `buildState`, `buildName`.

**Au nom de l'app ?** — **non documenté**. La page décrit la recherche dans l'interface ; elle ne dit rien de `asApp()`. Ce qui est documenté par ailleurs (S8, S20) : les endpoints de recherche filtrent par les permissions de l'utilisateur de la requête (« Issues are included in the response where the user has: Browse projects project permission… »). Donc un `asApp()` interroge avec les permissions de l'« app user » (et non celles du lecteur) : à valider sur prototype — c'est déjà listé en §14 du SPEC.

## 4. Endpoints REST utiles (dates : S18–S28, aucune date « Last updated » affichée)

### 4.1 Versions d'un projet

| Endpoint | Scopes (classique / granulaire) | Permission |
|---|---|---|
| `GET /rest/api/3/project/{projectIdOrKey}/version` (paginé) | `read:jira-work` / `read:project-version:jira` | Browse Projects |
| `GET /rest/api/3/project/{projectIdOrKey}/versions` (liste complète) | `read:jira-work` / `read:project-version:jira` | Browse Projects |
| `GET /rest/api/3/version/{id}` | `read:jira-work` / `read:project-version:jira` | Browse Projects |
| `GET /rest/api/3/version/{id}/relatedIssueCounts` | `read:jira-work` / `read:field:jira`, `read:project-version:jira` | Browse Projects |
| `GET /rest/api/3/version/{id}/unresolvedIssueCount` | `read:jira-work` / `read:project-version:jira` | Browse Projects |

Écrire une version (non requis) : `manage:jira-project` / `write:project-version:jira`.

### 4.2 Tickets d'une version (JQL `fixVersion`)

- **À utiliser** : `GET /rest/api/3/search/jql` (params `jql`, `maxResults`, `fields`, `expand`, `nextPageToken`, `fieldsByKeys`, `properties`, `failFast`, `reconcileIssues`, `includeArchivedProjects`) et `POST /rest/api/3/search/jql` (body `jql`, `fields`, `maxResults`, `nextPageToken`, `expand`, `fieldsByKeys`, `properties`, `reconcileIssues`, `includeArchivedProjects`).
  Scopes : classique `read:jira-work` ; granulaire GET → `read:issue-details:jira`, `read:audit-log:jira`, `read:avatar:jira`, `read:field-configuration:jira`, `read:issue-meta:jira` ; granulaire POST → `read:issue-details:jira`, `read:field.default-value:jira`, `read:field.option:jira`, `read:field:jira`, `read:group:jira`.
- **Déprécié** : `GET /rest/api/3/search` et `POST /rest/api/3/search` sont marqués « Currently being removed » / « Deprecated Endpoint is currently being removed ».
- `POST /rest/api/3/search/approximate-count` pour compter vite.
- JQL minimal : `project = "PAY" AND fixVersion = "2.4"`.

### 4.3 Historique (changelog)

| Endpoint | Portée | Scopes (classique / granulaire) |
|---|---|---|
| `GET /rest/api/3/issue/{issueIdOrKey}` avec `expand=changelog` | 1 ticket | `read:jira-work` / `read:issue-meta:jira`, `read:issue-security-level:jira`, `read:issue.vote:jira`, `read:issue.changelog:jira`, `read:avatar:jira`, … |
| `GET /rest/api/3/issue/{issueIdOrKey}/changelog` | 1 ticket, paginé (`startAt`, `maxResults`) | `read:jira-work` / `read:issue-meta:jira`, `read:avatar:jira`, `read:issue.changelog:jira` |
| `POST /rest/api/3/issue/{issueIdOrKey}/changelog/list` | par ids de changelog | idem |
| `POST /rest/api/3/changelog/bulkfetch` | **jusqu'à 1000 tickets**, filtrable par ≤ 10 `fieldIds` (ex. `fixVersion`, `status`) — corps : `issueIdsOrKeys`, `fieldIds`, `maxResults`, `nextPageToken` | `read:jira-work` / `read:issue-meta:jira`, `read:avatar:jira`, `read:issue.changelog:jira` |

→ Pour COMP-04 (« ticket ajouté à la version depuis moins de 48 h ») : `bulkfetch` filtré sur `fixVersion` est le chemin le moins coûteux ; le champ `created` du ticket est une approximation mais n'est pas l'historique.

### 4.4 Liens entre tickets

- Le champ `issuelinks` est renvoyé par `GET /rest/api/3/issue/{issueIdOrKey}` (ou `fields=issuelinks`) — c'est ce que recommande la doc des liens (S23).
- `GET /rest/api/3/issueLink/{linkId}` : `read:jira-work` / `read:field:jira`, `read:issue-link-type:jira`, `read:issue:jira`, `read:issue-type:jira`, `read:priority:jira`, ….
- Créer un lien : `POST /rest/api/3/issueLink` (hors périmètre).
- Côté graphe : `jira_work_item_links_jira_work_item` (liens) et `jira_work_item_blocks_jira_work_item` (dépendances) (§6).

### 4.5 Remote links (pages Confluence liées)

`GET /rest/api/3/issue/{issueIdOrKey}/remotelink` — scopes : `read:jira-work` / `read:issue.remote-link:jira`, `read:status:jira`. Réponse : un tableau de `RemoteIssueLink` (`globalId` = `system=…&id=…`, `object.url`, `object.title`). Paramètre `globalId` pour n'en lire qu'un.

Côté Confluence : `GET /wiki/api/v2/pages/{id}` — scope granulaire `read:page:confluence` (S28) ; params `body-format`, `status`, `version`, `include-labels`, `include-properties`, `include-versions`, … ; la réponse contient `version`/`createdAt` (utile pour DOC-01 : « non modifiée depuis le début du cycle »).
⚠️ La conversion **URL Confluence → id de page** n'est pas documentée dans les pages consultées : à faire à l'exécution (l'URL contient l'id) ou via `GET /wiki/api/v2/pages?space-id=…` — **non documenté** côté conversion automatique.

### 4.6 Incidents JSM par service

Trois voies, aucune n'étant un endpoint « incidents » :

1. **Ticket Jira** : les incidents JSM sont des tickets Jira de type « Incident » → `POST /rest/api/3/search/jql` avec `project = <projet JSM> AND issuetype = Incident` (+ `statusCategory != Done` pour EXP-01/EXP-02). Scopes `read:jira-work`.
2. **Champ « Affected services »** : c'est un **champ personnalisé** (Assets) créé par espace de service ; les services sont des objets Assets (S30, S31). Le nom exact du champ (« Affected services ») est documenté ; son **identifiant de champ n'est pas documenté** → à découvrir à l'exécution via `GET /rest/api/3/field` (scope `read:field:jira`).
3. **Teamwork Graph** : relation `jsm_incident_links_external_service` (§6) — c'est la voie la plus propre, mais elle exige un scope TWG et un appel au nom d'un utilisateur.

### 4.7 Divers

- Versions liées aux incidents : `GET /rest/api/3/version/{id}/relatedIssueCounts`.
- Champs : `GET /rest/api/3/field` (pour découvrir les champs « services affectés » / composants).

## 5. Vérifier les droits du lecteur (RI-10)

Ce que la doc propose, du plus direct au plus fin :

1. **Filtrage natif des permissions produit** (S8, S11) : les scopes n'override pas les permissions ; les résultats de recherche n'incluent que les tickets où l'utilisateur a « Browse projects » (+ sécurité au niveau ticket). → Faire la collecte **au nom du lecteur** (`asUser`) : ce qu'il ne voit pas n'est pas renvoyé.
2. **Teamwork Graph** (S15) : « Every row returned is permission-filtered for the authenticated user » et « Scopes are applied on top of normal permission filtering, so the user your query runs as still only sees what they can see in the product ». → le graphe appelé en `asUser` filtre déjà.
3. **Forge Authorize API** (S5) :
   ```ts
   import { authorize } from '@forge/api';
   const canEdit = await authorize().onJiraIssue(issueId).canEdit();
   const canAddComments = await authorize().onJiraIssue([id1, id2]).canAddComments();
   const canReadPage = await authorize().onConfluenceContent(pageId).canRead();
   const bulk = await authorize().onJira([{ permissions: ['BROWSE_PROJECTS'], issues: [10010, 10011] }]);
   ```
   ⚠️ **Il n'existe pas de `canRead()` sur les tickets Jira** dans cette API : les méthodes documentées sur `onJiraIssue` / `onJiraProject` sont `canAssign`, `canCreate`, `canEdit`, `canMove`, `canDelete`, `canAddComments`, `canEditAllComments`, `canDeleteAllComments`, `canCreateAttachments` (la doc répète `canDeleteAllComments` en fin de liste). Pour *lire*, seul `onConfluenceContent().canRead()` existe → **non documenté** côté Jira.
4. **Permissions en masse Jira** (S24) : `POST /rest/api/3/permissions/check` — corps `{ accountId, globalPermissions, projectPermissions: [{ permissions: ['BROWSE_PROJECTS'], issues: [10010], projects: [10001] }] }`, scope `read:permission:jira` (classique `read:jira-work`). Maximum 1000 tickets et 1000 projets ; la réponse ne renvoie que les tickets/projets **accordés**. ⚠️ Permission requise : « Administer Jira global permission to check the permissions for other users, otherwise none » → vérifier les droits d'un **autre** lecteur exige des droits d'administration ; sans eux, ne vérifier que l'utilisateur courant.
5. **Vérifier l'accès d'un lecteur à un ticket** (S20) : `POST /rest/api/3/jql/match` — « Checks whether one or more issues would be returned by one or more JQL queries », jusqu'à 10 JQL et 50 ids de tickets ; « issues are only matched against JQL queries where the user has: Browse projects project permission… » ; scope `read:jira-work` / `read:issue-details:jira`. Appelé en `asUser`, c'est le moyen documenté de savoir si le lecteur voit un ticket donné.
6. **Recette** (SPEC §17.4) : « la preuve de EXP-01 est remplacée par « 1 élément masqué » ». Stratégie documentée ci-dessus : calculer l'ensemble des ids visibles par le lecteur (`asUser` + la même JQL) et l'écart avec le dossier → afficher « N éléments masqués (accès restreint) » sans nommer l'objet.

## 6. Relations Teamwork Graph utiles — noms exacts (S14, pages de relation)

| Relation (Cypher) | De → vers | Type d'objet source | Scope nécessaire |
|---|---|---|---|
| `jira_work_item_links_external_commit` | ticket → commit | Jira work item | `read:graph:issue:jira` + `read:graph:commit:external` |
| `jira_work_item_impacts_compass_component` | ticket → composant Compass | Jira work item | `read:graph:issue:jira` + `read:graph:component:compass` |
| `jsm_incident_links_external_service` | incident → service | Jira work item | `read:graph:issue:jira` + `read:graph:service:external` |
| `atlassian_team_owns_compass_component` | équipe → composant Compass | Atlassian team | `read:graph:team:atlassian` + `read:graph:component:compass` |
| `external_pull_request_has_external_commit` | PR → commit | External pull request | `read:graph:pull-request:external` + `read:graph:commit:external` |
| `jira_version_links_jira_work_item` | version → tickets | Jira version | `read:graph:version:jira` + `read:graph:issue:jira` |
| `jira_work_item_links_jira_work_item` | ticket → ticket lié | Jira work item | `read:graph:issue:jira` |
| `jira_work_item_blocks_jira_work_item` | ticket → ticket bloqué | Jira work item | `read:graph:issue:jira` |
| `jira_space_has_jira_work_item` | espace → tickets | Jira space | `read:graph:project:jira` + `read:graph:issue:jira` |
| `atlassian_team_assigned_jira_work_item` | équipe → tickets assignés | Atlassian team | `read:graph:team:atlassian` + `read:graph:issue:jira` |
| `atlassian_user_reviewed_pull_requests` | utilisateur → PR relues | Atlassian user | `read:graph:user:atlassian` + `read:graph:pull-request:external` |
| `jira_work_item_links_jira_work_item_remote_link` | ticket → lien distant Jira | Jira work item | `read:graph:issue:jira` + `read:graph:issue-remote-link:jira` |
| `jira_work_item_links_external_remote_link` | ticket → lien distant externe | Jira work item | `read:graph:issue:jira` + `read:graph:remote-link:external` |

Notes utiles :
- Le « PR » du graphe est `ExternalPullRequest` (Bitbucket ou outil connecté) : il n'existe **pas** de relation directe ticket ↔ PR documentée ; il faut passer par les commits (`jira_work_item_links_external_commit` puis `external_pull_request_has_external_commit`).
- `external_pull_request_has_external_commit` : « Represents 100 recent commits in the pull-requests », TTL 365 jours.
- Un incident JSM est bien un **Jira work item** dans le graphe (type source de `jsm_incident_links_external_service`).
- Pas de relation documentée « ticket → page Confluence » : les liens distants passent par `jira_work_item_links_jira_work_item_remote_link` (→ `JiraWorkItemRemoteLink`, scope `read:graph:issue-remote-link:jira`) ou `jira_work_item_links_external_remote_link` (→ `ExternalRemoteLink`, scope `read:graph:remote-link:external`), ou par `/remotelink` en REST.

## 7. Résumé et pièges (≤ 10 lignes)

1. Pas de `requestJiraServiceManagement` : JSM passe par `requestJira('/rest/servicedeskapi/…')`.
2. Pas de `asApp().requestTeamworkGraph` : le graphe est **utilisateur uniquement** → collecte à l'ouverture de la page, mise en cache.
3. Cypher brut fermé aux nouvelles apps : `customQuery(queryKey, queryParams)` + enregistrement préalable (`POST /gateway/api/twg/cypher-queries`).
4. Scope TWG manquant = résultat **vide sans erreur** ; scope d'un objet intermédiaire manquant = traversée entière vide.
5. `GET/POST /rest/api/3/search` dépréciés → utiliser `/rest/api/3/search/jql` (pagination par `nextPageToken`).
6. JQL `development[…]` documenté (support.atlassian.com) mais **usage au nom de l'app non documenté** → à prototyper.
7. `read:dev-info:jira` sert aux API *fournisseur* de dev-info, pas à la lecture des PR d'un ticket → privilégier TWG ou JQL.
8. Aucun endpoint JSM « incidents » : passer par les tickets Jira de type Incident + champ « Affected services » (id de champ non documenté).
9. RI-10 : `authorize()` n'a pas de `canRead` Jira ; utiliser `asUser` + `POST /rest/api/3/jql/match` (ou `/permissions/check`, qui exige un droit d'admin pour vérifier *un autre* utilisateur).
10. Attention au plafond de 50 scopes et à la propagation ~1 min (scopes TWG et `queryKey`).
