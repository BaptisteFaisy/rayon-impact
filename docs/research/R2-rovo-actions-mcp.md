# Référence exacte : modules `rovo:agent`, `action` et `rovo:mcp` (Forge v3 / TypeScript)

> Document produit pour le projet « Rayon d'impact d'une release » (Hackathon Codegeist 2026).
> Basé exclusivement sur la documentation officielle Atlassian Developer (manifest reference, runtime, tutoriels).

---

## Sources officielles et dates de mise à jour

| Document / Page | URL officielle | Last updated |
|---|---|---|
| **Action module** | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/ | Aug 3, 2026 |
| **Rovo MCP module (Preview)** | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/ | Oct 29, 2026 |
| **Rovo Agent module** | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/ | Oct 2, 2026 |
| **Rovo modules index** | https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-index/ | Oct 29, 2026 |
| **Tutorial: Build a Rovo Agent hello world app** | https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-agent/ | Mar 3, 2025 |
| **Tutorial: Build a Rovo MCP hello world app** | https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-mcp/ | Oct 29, 2026 |
| **Tutorial: Read Jira issues with a Rovo MCP tool** | https://developer.atlassian.com/platform/forge/read-jira-issues-with-a-rovo-mcp-tool/ | Oct 29, 2026 |
| **Invocation limits** | https://developer.atlassian.com/platform/forge/limits-invocation/ | Sep 1, 2026 |
| **Function arguments** | https://developer.atlassian.com/platform/forge/function-reference/arguments/ | Nov 25, 2025 |
| **Permissions & Scopes** | https://developer.atlassian.com/platform/forge/manifest-reference/permissions/ | Sep 16, 2026 |

---

## 1. Module `action`

### 1.1 Rôle et nature
Le module Forge `action` (déclaré sous `modules.action`) permet à un agent Rovo ou à un serveur MCP d'exécuter une opération spécifique (appel d'API Atlassian, requête externe, calcul métier). Une action est adossée à une fonction Forge hébergée (`function`) ou à un point de terminaison distant (`endpoint` avec Forge Remote).

### 1.2 Structure YAML complète

```yaml
modules:
  action:
    - key: <string>            # [Obligatoire] Clé unique. Regex: ^[a-zA-Z0-9_-]+$, < 64 car. si référencée dans rovo:mcp
      name: <string>           # [Obligatoire] Nom affiché dans l'UI / Rovo Studio
      function: <string>       # [Obligatoire*] Clé de la fonction Forge déclarée sous modules.function
      # endpoint: <string>     # [*Alternative] Si Forge Remote est utilisé à la place de function
      actionVerb: <enum>       # [Obligatoire] GET | CREATE | UPDATE | DELETE | TRIGGER
      description: <string>    # [Obligatoire] Description textuelle que le LLM utilise pour décider quand appeler l'action
      inputs:                  # [Obligatoire] Map des entrées { <inputName>: { title, type, required, description } }
        <inputName>:
          title: <string>        # [Obligatoire] Intitulé de l'entrée
          type: <enum>           # [Obligatoire] Types autorisés : string | integer | number | boolean
          required: <boolean>    # [Obligatoire] true si obligatoire, false sinon
          description: <string>  # [Incohérence doc] l'arbre du manifest l'indique [Optional], le tableau des propriétés l'indique Required=Yes → la traiter comme obligatoire
```

#### Remarques et contraintes documentées sur `action` :
- **Types d'inputs autorisés** : uniquement `string`, `integer`, `number`, `boolean`. **Aucun type `array` ni `object` n'est supporté**. Pour passer une liste (ex. liste d'identifiants de tickets Jira), elle doit transiter sous forme de chaîne de caractères délimitée (ex. CSV `PROJ-1,PROJ-2`).
- **Description de sortie (`output`)** : **aucune déclaration d'output dans le manifest YAML**. La documentation officielle précise que la fonction Forge retourne simplement une chaîne de caractères (`string`) ou un objet JSON (`object`), que l'agent Rovo / MCP interprète ensuite pour répondre en langage naturel.
- **Limite de charge utile** : 5 MB maximum pour les données traitées/retournées par une action (limite de taille des dépendances / payload Forge).
- **Automation rules** : les agents Rovo déclenchés par des règles Jira/Confluence Automation **n'invoquent JAMAIS** les actions dont le verbe est `CREATE`, `UPDATE`, `DELETE` ou `TRIGGER`. Seul `actionVerb: GET` est exécutable depuis une automatisation.

---

### 1.3 Exemples copiables pour le manifest

#### Exemple 1 : Action GET à 2 entrées (`get-release-impact`)
```yaml
modules:
  action:
    - key: get-release-impact
      name: Get release impact
      function: fn-get-release-impact
      actionVerb: GET
      description: |
        Retrieves the release impact verdict, confidence score, summary, and signal counts
        for a given Jira project and release version name.
      inputs:
        projectKey:
          title: Project Key
          type: string
          required: true
          description: The uppercase key of the Jira project, e.g. "REL" or "KAN".
        versionName:
          title: Version Name
          type: string
          required: true
          description: The name of the project version / release, e.g. "2.4.0".

  function:
    - key: fn-get-release-impact
      handler: release-impact.getReleaseImpact   # convention documentée : <fichier-sans-extension>.<export>, fichier dans src/
```

> **Convention `handler`** (tutoriels officiels) : `hello-world-mcp.messageLogger` pointe la fonction
> `messageLogger` exportée depuis `src/hello-world-mcp.js`. Le chemin est le nom du module (résolu
> par le bundler Forge), **sans préfixe `src/` et sans extension**.

#### Exemple 2 : Action CREATE à 3 entrées (`request-waiver`)
```yaml
modules:
  action:
    - key: request-waiver
      name: Request waiver
      function: fn-request-waiver
      actionVerb: CREATE
      description: |
        Requests a temporary waiver for a blocking release signal, specifying the business
        reason and duration in hours.
      inputs:
        signalId:
          title: Signal ID
          type: string
          required: true
          description: Unique identifier of the signal to waive, e.g. "sig-sec-042".
        reason:
          title: Reason
          type: string
          required: true
          description: Justification for bypassing or waiving this signal for the release.
        hours:
          title: Duration in Hours
          type: integer
          required: true
          description: Number of hours this waiver should remain active (e.g. 24 or 72).

  function:
    - key: fn-request-waiver
      handler: release-impact.requestWaiver
```

---

## 2. Câblage TypeScript côté backend / Resolver

### 2.1 Mode d'invocation : fonction Forge directe vs `@forge/resolver`

Il existe une distinction capitale documentée dans Forge :
1. **Le pattern documenté pour une `action` Rovo n'est PAS `@forge/resolver` (`new Resolver()`, `resolver.define(...)`, `getDefinitions()`)**.
   - `@forge/resolver` est le mécanisme documenté pour les communications entre le frontend d'une UI (UI Kit ou Custom UI via `@forge/bridge` `invoke()`) et sa fonction backend. La page « Forge resolver » (runtime-reference, Last updated Nov 8, 2024) ne mentionne pas les modules `action`/`rovo:mcp`.
   - Une `action` est implémentée comme une **fonction Forge ordinaire** : la page Action précise « Actions are implemented as a Forge function » et « The payload and context are passed into the function as arguments. Please refer to Function Arguments ».
   - La page Function Arguments confirme : `export const handler = (payload, context) => { ... }`, et précise que seules les fonctions implémentées avec `@forge/resolver` reçoivent leurs arguments différemment (`{ payload, context }` en un seul objet).
   - Le manifest pointe directement le handler exporté : `handler: <module>.<export>`.
   - **Piège** : dans le tutoriel MCP officiel, la clé de la `function` s'appelle `resolver` (`function: - key: resolver, handler: hello-world-mcp.messageLogger`) — c'est un simple nom de clé, sans rapport avec le package `@forge/resolver`. Il n'y a aucune API `defineAction` documentée.

### 2.2 Signature TypeScript exacte et forme du `payload` / `context`

```typescript
export interface ActionPayload<TInputs = Record<string, unknown>> {
  // 1. Les inputs extraits par le LLM d'après le manifest
  [inputName: string]: unknown;

  // 2. Le contexte Atlassian déterministe injecté par l'hôte si disponible
  context?: {
    cloudId?: string;
    moduleKey?: string;
    jira?: {
      url?: string;
      resourceType?: string;   // ex. documenté : "issue"
      issueKey?: string | number;
      issueId?: number | string;
      issueType?: string;
      issueTypeId?: number | string;
      projectKey?: string;
      projectId?: number | string;
    };
    confluence?: {
      url?: string;
      resourceType?: string;   // ex. documentés : "page", "blog"
      contentId?: string;
      spaceKey?: string;
      spaceId?: string;
    };
  };
}

export interface InvocationContext {
  installContext: string; // ARI de l'installation
  principal?: {
    accountId: string;    // ID Atlassian du compte utilisateur ayant déclenché l'action
  };
  workspaceId?: string;
  license?: {
    active: boolean;
    isActive: boolean;
    billingPeriod?: string | null;
    type?: string | null;
  };
  installation?: {
    ari: { installationId: string };
  };
}
```

### 2.3 Règle de sécurité sur les `inputs` vs `context`
- **Les `inputs` proviennent de l'extraction par le LLM** : ils sont flexibles mais sujets aux hallucinations ou aux manipulations de prompt.
- **Règle Atlassian formelle** : Ne jamais se fier aux `inputs` pour des contrôles d'autorisation ou l'identité utilisateur. Pour obtenir l'utilisateur actif de manière sécurisée, lire `context.principal.accountId`.
- Pour les identifiants d'issue Jira, l'approche recommandée par Atlassian est d'inspecter `payload.context?.jira?.issueKey` en secours ou en validation de l'input LLM.

### 2.4 Valeur de retour
- La fonction peut retourner un **`string`** ou un **objet JSON sérialisable** (`Record<string, unknown>`).
- L'agent Rovo ou le client MCP interprète ce retour et génère la réponse finale pour l'utilisateur.

### 2.5 Timeout applicable
- D'après la page officielle *Invocation limits* (mise à jour le 1er septembre 2026) :
  - **Limite d'exécution pour les modules `action` et `rovo:agentConnector`** : **55 secondes maximum**.
  - Si le handler dépasse 55 secondes, l'exécution est interrompue par la plateforme.
  - *(Rappel : les fonctions de background queues `consumer` et `scheduledTrigger` peuvent monter à 900 s, mais une action Rovo synchrone est bornée à 55 s).*

### 2.6 Exemple complet TypeScript d'un handler d'action

```typescript
import api, { route } from '@forge/api';

interface GetReleaseImpactInputs {
  projectKey: string;
  versionName: string;
}

// Signature documentée (Function Arguments + tutoriels) : (payload, context)
// - payload : inputs extraits par le LLM + payload.context (contexte app déterministe)
// - context : contexte d'invocation Forge (principal.accountId, installContext, ...)
export async function getReleaseImpact(
  payload: GetReleaseImpactInputs & { context?: any },
  context: any
): Promise<string> {
  const { projectKey, versionName } = payload;
  const callerAccountId = context?.principal?.accountId; // identité sûre : jamais les inputs

  if (!projectKey || !versionName) {
    return `Erreur : projectKey et versionName sont requis.`;
  }

  // Endpoint REST Jira réel : liste des versions d'un projet
  // (https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-versions/)
  const res = await api
    .asUser() // respecte les permissions Jira de l'appelant (pattern du tutoriel officiel)
    .requestJira(route`/rest/api/3/project/${projectKey}/versions`);

  if (!res.ok) {
    return `Impossible de lister les versions du projet ${projectKey} (statut ${res.status}).`;
  }

  const versions: Array<{ id: string; name: string; released: boolean }> = await res.json();
  const version = versions.find((v) => v.name === versionName);

  if (!version) {
    return `Aucune version nommée "${versionName}" trouvée sur le projet ${projectKey}.`;
  }

  // Retour : string ou objet JSON — l'agent Rovo l'interprète pour répondre à l'utilisateur.
  // Ici le dossier d'impact serait lu depuis le stockage SQL de l'app (cf. SPEC §12).
  return JSON.stringify({
    versionId: version.id,
    versionName: version.name,
    released: version.released,
    verdict: "GO_WITH_RESERVATIONS",
    confidence: 0.85,
    signalsCount: { critical: 0, high: 2, medium: 1 },
    summary: `La version ${versionName} présente 2 signaux importants non bloquants.`
  });
}
```

---

## 3. Module `rovo:mcp` (Preview)

### 3.1 Rôle et principes
Le module `rovo:mcp` expose des modules `action` existants sous la forme d'outils compatibles avec le protocole standard **MCP (Model Context Protocol)**. Ces outils deviennent accessibles :
1. Aux agents personnalisés créés par les utilisateurs dans **Rovo Studio**.
2. À des clients IA externes compatibles MCP (ex. Claude Code, Cursor, agents personnalisés tiers).

### 3.2 Structure YAML complète

```yaml
modules:
  rovo:mcp:
    - key: <string>        # [Obligatoire] Clé unique du module. Regex: ^[a-zA-Z0-9_-]+$
      name: <string>       # [Obligatoire] Nom du serveur MCP. MAX 30 CARACTÈRES.
      tools:               # [Obligatoire] Liste des clés d'actions exposées comme outils MCP
        - <action-key-1>
        - <action-key-2>
```

*(Note : le schéma générique du manifest mentionne également une propriété optionnelle `resources: [{ key, path }]` si l'application charge des ressources statiques liées).*

### 3.3 Limites strictes documentées
- **1 seul module par app** : une application Forge ne peut déclarer qu'au maximum **un seul module `rovo:mcp`**.
- **Plafond d'outils** : au maximum **50 actions** peuvent être listées dans `tools`.
- **Longueur des clés d'action** : chaque clé d'action référencée dans `tools` doit faire **strictement moins de 64 caractères**.
- **Longueur du nom de l'agent MCP** : la propriété `name` ne doit pas dépasser **30 caractères**.
- **Statut Preview** : supporté en production mais soumis à des cycles d'évolution et de dépréciation plus courts.

### 3.4 Exposition et autorisation d'un client MCP externe
1. **Désactivé par défaut** : l'exposition MCP externe n'est jamais ouverte automatiquement.
2. **Activation par un administrateur** :
   - Un administrateur de site ou d'organisation doit se rendre sur `admin.atlassian.com` :
     `Apps > Sites > <votre-site> > Connected apps`.
   - Sélectionner l'application Forge concernée.
   - Activer individuellement les outils à rendre accessibles aux clients externes.
3. **Point de terminaison (URL de connexion MCP)** :
   ```
   https://mcp.atlassian.com/forge/<appId>
   ```
   où `<appId>` est la partie UUID de l'identifiant Forge (`app.id` dans `manifest.yml`), c'est-à-dire la chaîne qui suit `ari:cloud:ecosystem::app/`.
4. **Protocole d'authentification** :
   - Le client MCP se connecte via HTTP / OAuth 2.1.
   - L'utilisateur s'authentifie sur un écran de consentement Atlassian OAuth 2.1, choisit le site autorisé et valide les scopes demandés.
   - **Piège documenté sur `asUser()` vs `asApp()`** : pour des clients MCP tiers externes, les appels `api.asUser()` peuvent échouer si l'utilisateur n'a pas encore une entrée de consentement explicite enregistrée dans ses Connected apps Atlassian (`id.atlassian.com/manage-profile/apps`). La documentation Atlassian note qu'il s'agit d'un problème connu en cours de résolution et recommande, si ce consentement ne peut être garanti pour le client externe, d'utiliser `api.asApp()`.

---

## 4. Module `rovo:agent`

### 4.1 Structure YAML complète

```yaml
modules:
  rovo:agent:
    - key: <string>                      # [Obligatoire] Clé unique. Regex: ^[a-zA-Z0-9_-]+$
      name: <string>                     # [Obligatoire] Nom de l'agent. MAX 30 CARACTÈRES.
      description: <string>              # [Optionnel] Description du rôle de l'agent pour les utilisateurs
      prompt: <string>                   # [Obligatoire] Prompt système détaillant le comportement de l'agent
                                         # (soit chaîne en ligne, soit ref "resource:<key>;<path>")
      icon: <string>                     # [Optionnel] Icône de l'avatar (ex: resource:<key>;icons/agent.svg ou URL HTTPS)
      conversationStarters:              # [Optionnel] Liste d'amorces suggérées à l'utilisateur
        - <string>
      actions:                           # [Optionnel] Liste des clés des actions Forge que l'agent peut invoquer
        - <action-key-1>
        - <action-key-2>
      skills:                            # [Optionnel] Liste de clés de modules rovo:skill (Preview)
        - <skill-key-1>
      followUpPrompt: <string>           # [Optionnel] Prompt utilisé pour générer des suggestions de suivi
```

### 4.2 Contraintes et règles clés pour `rovo:agent`
- **Contrainte de nom** : la propriété `name` **ne doit pas dépasser 30 caractères** (ex. `"Rayon d'impact"` = 15 car., valide).
- **Liaison des actions** : l'agent déclare la liste des actions qu'il peut exécuter via le champ `actions` (tableau de chaînes correspondant aux `key` des modules `action`). L'agent décide de manière autonome quand invoquer une action en s'appuyant sur les champs `name`, `description` et le schéma des `inputs` de l'action.
- **Amorces de conversation (`conversationStarters`)** : liste de phrases affichées sous forme de boutons cliquables dans le panneau latéral Rovo Chat.
- **Externalisation du prompt** : si le prompt est volumineux, il est recommandé de le déporter dans un fichier texte pour ne pas saturer la limite de 200 KB du fichier `manifest.yml` :
  `prompt: resource:agent-prompts;prompts/system-prompt.txt` (nécessite Forge CLI >= 10.6.0).
- **Cloisonnement des données** : un agent Forge n'accède qu'aux données du workspace dans lequel l'app est installée (par défaut Jira si installée sur Jira).

---

## 5. Scopes et permissions à déclarer

### 5.1 Scopes généraux du manifest (`permissions.scopes`)
- **Ni `rovo:agent`, ni `action`, ni `rovo:mcp` n'exigent de scope OAuth 2.0 spécifique pour être déclarés en tant que modules Rovo** (aucun scope propre à ces modules n'est documenté sur leurs pages de référence). En revanche, les pages Rovo imposent le respect de l'*Atlassian Acceptable Use Policy* (section « Artificial intelligence offerings and features ») : Atlassian effectue un **safety screening** des agents et peut bloquer un déploiement ou suspendre l'usage des Rovo APIs.
- La section `permissions.scopes` **doit déclarer tous les scopes OAuth correspondant aux API Atlassian que les fonctions d'action appellent** (page Permissions, Last updated Sep 16, 2026). Scopes confirmés par les pages lues :
  - `read:jira-work` — lecture d'issues Jira (utilisé tel quel dans le tutoriel « Read Jira issues with a Rovo MCP tool »).
  - `write:jira-work` — cité en exemple dans la page Permissions.
  - Tout autre scope (versions, composants, JSM, Teamwork Graph…) : **non documenté sur les pages lues** — à vérifier dans les références dédiées : Jira scopes (`/platform/forge/manifest-reference/scopes-product-jira/`), JSM scopes, et Teamwork Graph scopes (`/platform/teamwork-graph/scopes/`, lien donné par la page Permissions).
- Si l'app n'appelle aucune API OAuth, `permissions.scopes: []` (liste vide) reste obligatoire.
- **À chaque ajout/modification de scope : `forge deploy` puis `forge install` à rejouer** (le tutoriel MCP Jira le précise explicitement).

### 5.2 Teamwork Graph
La page Permissions renvoie vers la référence « Teamwork Graph scopes » (`/platform/teamwork-graph/scopes/`) pour connaître les scopes à déclarer pour `requestTeamworkGraph`. Les noms exacts de scopes ne figurent pas sur les pages lues ici : **non documenté dans cette recherche**, à lire séparément (cf. SPEC §12 « Lecture du Teamwork Graph »).

---

## 6. Manifeste récapitulatif pour « Rayon d'impact » (Extrait cible)

```yaml
app:
  id: "ari:cloud:ecosystem::app/<votre-uuid>"
  runtime:
    name: nodejs24.x
    memoryMB: 512
    architecture: arm64

modules:
  # 1. Agent Rovo principal
  rovo:agent:
    - key: rayon-impact-agent
      name: "Rayon d'impact"           # <= 30 caractères (15 car.)
      description: "Analyse le risque et le rayon d'impact d'une release Jira avant déploiement."
      prompt: |
        Tu es l'agent expert "Rayon d'impact d'une release". Tu évalues si une version Jira
        est prête à être déployée. Tu ne calcules rien toi-même : tu invoques les actions
        ci-dessous et tu restitues fidèlement leurs résultats avec les liens pertinents.
      conversationStarters:   # forme inline acceptée en YAML, identique à la forme liste
        - "Peut-on livrer la 2.4 ?"
        - "Qu'est-ce qui retient la prochaine version ?"
        - "Quelles équipes sont touchées par la 2.4 ?"
        - "Que s'est-il passé après la 2.3 ?"
      actions:
        [get-release-impact, list-release-signals, explain-signal, list-impacted-teams,
         simulate-without, get-release-outcome, request-waiver]

  # 2. Exposition des mêmes actions en serveur MCP (1 seul module rovo:mcp par app)
  rovo:mcp:
    - key: rayon-impact-mcp
      name: "Rayon d'impact MCP"       # <= 30 caractères (20 car.)
      tools:
        [get-release-impact, list-release-signals, explain-signal, list-impacted-teams,
         simulate-without, get-release-outcome, request-waiver]

  # 3. Déclaration des 7 modules action
  action:
    - key: get-release-impact
      name: Get release impact
      function: fn-actions
      actionVerb: GET
      description: Returns the release impact verdict, confidence score, summary, and signal counts for a project version.
      inputs:
        projectKey:
          title: Project Key
          type: string
          required: true
          description: Jira project key (e.g. "REL").
        versionName:
          title: Version Name
          type: string
          required: true
          description: Name of the release version (e.g. "2.4").

    - key: list-release-signals
      name: List release signals
      function: fn-actions
      actionVerb: GET
      description: Returns detailed risk signals with supporting evidence for a given release version ID.
      inputs:
        versionId:
          title: Version ID
          type: string
          required: true
          description: Numeric ID of the Jira release version.
        severity:
          title: Severity filter
          type: string
          required: false
          description: Optional severity filter (CRITICAL, HIGH, MEDIUM, LOW).

    # Schéma identique (1 input string requis "versionId", actionVerb GET) pour :
    #   - explain-signal      : input signalId (string, requis)
    #   - list-impacted-teams : input versionId
    #   - get-release-outcome : input versionId

    - key: simulate-without
      name: Simulate without issues
      function: fn-actions
      actionVerb: GET
      description: Recalculates the release impact verdict simulating the exclusion of specific issues.
      inputs:
        versionId:
          title: Version ID
          type: string
          required: true
          description: Numeric ID of the Jira release version.
        issueKeys:
          title: Excluded issue keys
          type: string
          required: true
          description: Comma-separated Jira issue keys to exclude from calculation (e.g. "PROJ-12,PROJ-45").

    - key: request-waiver
      name: Request waiver
      function: fn-actions
      actionVerb: CREATE
      description: Creates a formal waiver bypass for a blocking signal with business justification.
      inputs:
        signalId:
          title: Signal ID
          type: string
          required: true
          description: Identifier of the signal to waive.
        reason:
          title: Waiver reason
          type: string
          required: true
          description: Business reason explaining why the signal can be bypassed.
        hours:
          title: Duration in hours
          type: integer
          required: true
          description: Number of hours the waiver remains in effect.

  # 4. Fonction backend unique distribuant les actions (ou fonctions dédiées)
  #    Convention handler documentée : <module-sans-extension>.<export>, module dans src/
  function:
    - key: fn-actions
      handler: release-impact.dispatch   # ex. export function dispatch(payload, context) dans src/release-impact.ts

permissions:
  scopes:
    - read:jira-work
    - write:jira-work
```

---

## 7. Pièges à retenir (synthèse)

1. **Pas de tableaux/objets en inputs** : uniquement `string | integer | number | boolean` → `issueKeys` de `simulate-without` passe en chaîne CSV.
2. **Pas d'`output` dans le manifest** : la fonction retourne string ou JSON, point. Le LLM met en forme.
3. **55 s de timeout** pour toute fonction référencée par un module `action` (pas de `timeoutSeconds` extensible comme pour les consumers 900 s).
4. **Automation Jira n'invoque jamais** les actions `CREATE/UPDATE/DELETE/TRIGGER` → `request-waiver` inutilisable depuis une règle d'automation.
5. **Un seul `rovo:mcp` par app, 50 outils max, clés d'action < 64 car., `name` du MCP ≤ 30 car.** (idem `rovo:agent.name` ≤ 30 car.).
6. **Ne jamais faire d'autorisation sur les inputs** (extraits par le LLM, hallucinables) : identité = `context.principal.accountId` ; ids d'app = `payload.context.jira.*`.
7. **Exposition MCP externe désactivée par défaut** : un admin doit l'activer par site dans admin.atlassian.com (Connected apps) ; URL = `https://mcp.atlassian.com/forge/<appId>` (UUID après `ari:cloud:ecosystem::app/`), OAuth 2.1 au premier branchement.
8. **`asUser()` peut échouer depuis un client MCP tiers** sans entrée de consentement Connected apps de l'utilisateur (bug connu doc) → prévoir un repli `asApp()` pour les outils en lecture.
9. **Chaque changement de scope impose `forge deploy` + `forge install`** ; payload max 5 Mo par invocation d'action.
10. **Le mot « resolver » dans les tutos MCP est juste un nom de clé `function`** — les actions n'utilisent pas `@forge/resolver` (réservé au frontend `invoke`) ; pas de `defineAction` documenté : `export function x(payload, context)` suffit.
