# R1 — Modules Jira UI du manifest Forge (UI Kit 2 / React)

> Document produit pour « Rayon d'impact d'une release » (Codegeist 2026).
> Basé **exclusivement** sur la documentation officielle Atlassian Developer, lue le **2026-11-11**.
> Rien n'est inventé : ce qui n'est pas dans la doc est marqué **« non documenté »**.

## Sources

| Page | URL | Last updated |
|---|---|---|
| Jira project page | https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/ | Sep 22, 2026 |
| Jira issue context | https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-context/ | Oct 9, 2026 |
| Jira project settings page | https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-settings-page/ | Sep 22, 2026 |
| Jira dashboard gadget | https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-dashboard-gadget/ | Aug 12, 2025 |
| Resources | https://developer.atlassian.com/platform/forge/manifest-reference/resources/ | Sep 24, 2026 |
| App compatibility | https://developer.atlassian.com/platform/forge/app-compatibility/ | Oct 30, 2026 |
| UI Kit overview (point d'entrée React) | https://developer.atlassian.com/platform/forge/ui-kit/overview/ | Jul 7, 2026 |
| useProductContext | https://developer.atlassian.com/platform/forge/ui-kit/hooks/use-product-context/ | Sep 29, 2026 |

Index consulté (aucun 404 rencontré) : https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-jira/

## 0. Câblage commun (UI Kit « moderne » = UI Kit 2)

Ce que la doc dit, indépendamment du module :

- Un module UI a **trois** pièces : `resource` (le front), `resolver` (le back), `render` (le mode d'affichage).
  « Modules necessitate a resource, resolver, and a render mode » (UI Kit overview).
- `render: native` = « Indicates the module uses UI Kit ». **Requis si UI Kit moderne** ; `resource` seul = Custom UI.
- `resolver` accepte `{ function: <clé de module function> }` (fonction hébergée Forge) **ou**
  `{ endpoint: <clé de remotes> }` (Forge Remote).
- **Signature du composant React** : point d'entrée `src/frontend/index.jsx`, rendu par
  `ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>)`. La doc montre un composant
  **sans aucune prop** (`const App = () => (…)`) : aucun contrat de props n'est documenté pour ces 4 modules.
  Dépendances : `react@18` + `@forge/react@latest`.
- **Contexte reçu** (UI Kit) : hook `useProductContext()`, retour `ProductContext | undefined`
  (**`undefined` pendant le chargement** — la doc insiste : « context data is loaded asynchronously »).
  Champs génériques : `accountId?`, `cloudId?`, `workspaceId?`, `extension` (spécifique au module),
  `installation?`, `license?`, `localId`, `locale`, `moduleKey`, `siteUrl`, `timezone`, `theme?`.
  Le contexte **du module** est dans `context.extension` (cf. chaque module ci-dessous).
  Équivalent Custom UI : `view.getContext()` (bridge `@forge/bridge`).
- i18n : toute propriété « string or i18n object » s'écrit `{ i18n: "<clé de traduction>" }`
  (une seule clé `i18n`, obligatoire, référençant un fichier de traductions).

---

## 1. `jira:projectPage`

Onglet horizontal dans la navigation projet Jira (dans JSM : navigation gauche du projet).
URL construite : `/jira/{projectType}/projects/{projectKey}/apps/{appId}/{envId}`.
Utilisable en **Jira et JSM**. À déclarer comme composant de **premier niveau**.

### Structure YAML

```yaml
modules:
  jira:projectPage:            # tableau de modules
    - key:                     # string, MANDATORY. regex ^[a-zA-Z0-9_-]+$, unique dans le manifest
      resource:                # string, MANDATORY si Custom UI ou UI Kit moderne : clé d'une entrée `resources`
      render: native           # 'native', MANDATORY si UI Kit moderne
      resolver:                # MANDATORY (forme au choix)
        function: <fn-key>     #   ou
        endpoint: <remote-key> #   Forge Remote
      title:                   # string | i18n, MANDATORY. Onglet + titre de page
      icon:                    # string, OPTIONAL. chemin relatif depuis une ressource OU URL absolue
      layout: native           # OPTIONAL, défaut native.
                               #   UI Kit : native | basic
                               #   Custom UI : native | blank | basic (deprecated)
      pages:                   # Page[], OPTIONAL. `pages` XOR `sections` (jamais les deux)
        - title:               #   string | i18n, MANDATORY (titre dans la sidebar)
          route:               #   string, MANDATORY, unique, suffixé à l'URL de la page
          icon:                #   string, OPTIONAL (URL d'icône)
          displayConditions:   #   object, OPTIONAL
      sections:                # Section[], OPTIONAL
        - header:              #   string | i18n, OPTIONAL
          pages:               #   Page[], MANDATORY
          displayConditions:   #   object, OPTIONAL (masque la section ET ses pages)
      displayConditions:       # object, OPTIONAL
```

Contraintes documentées :
- `pages`/`sections` ne changent **que la structure d'URL** ; le routage réel est à faire côté app
  via `view.createHistory()` → **sous-pages = Custom UI uniquement**.
- `key` : unique dans le manifest, regex `^[a-zA-Z0-9_-]+$`.

### Exemple minimal copiable (doc)

```yaml
modules:
  jira:projectPage:
    - key: hello-world-project-page
      resource: main
      resolver:
        function: resolver
      render: native
      title: Hello World!
```

### Câblage code

- `render: native` (UI Kit) + `resource: <clé resources>` + `resolver.function: <clé function>`.
- Composant React : `src/frontend/index.jsx`, `const App = () => (…)` puis `ForgeReconciler.render(...)` ;
  **aucune prop** documentée.
- Contexte : `useProductContext().extension` →
  `type` (type de module), `project.id`, `project.key`, `project.type`,
  `board.id` et `board.type` (`"simple" | "scrum" | "kanban"`, **Jira Software seulement**), `location` (URL complète).

---

## 2. `jira:issueContext`

Panneau repliable sous les autres champs, à droite de la vue issue (**nouvelle** vue uniquement, pas l'ancienne).
Utilisable en **Jira et JSM**. Remplace à terme le module Issue Glance (guide de migration dédié).

### Structure YAML

```yaml
modules:
  jira:issueContext:
    - key:                     # string, MANDATORY. regex ^[a-zA-Z0-9_-]+$
      resource:                # string, MANDATORY si Custom UI / UI Kit moderne
      render: native           # 'native', MANDATORY si UI Kit moderne
      resolver:                # MANDATORY
        function: <fn-key>     #   ou endpoint: <remote-key>
      title:                   # string | i18n, MANDATORY. affiché à côté du label
      label:                   # string | i18n, MANDATORY. texte du bouton du panneau
      icon:                    # string, OPTIONAL. URL ABSOLUE uniquement (à gauche du label)
      status:                  # object, OPTIONAL. badge/lozenge/icône à droite du label ; rien si absent
        type: lozenge          #   'badge' | 'lozenge' | 'icon', MANDATORY
        value:                 #   object, MANDATORY
          label:               #     string, MANDATORY (si type=badge : un nombre sous forme de chaîne, ex. '3')
          url:                 #     string, OPTIONAL (utilisé si type=icon)
          type: default        #     OPTIONAL si type=lozenge :
                               #     'default' | 'inprogress' | 'moved' | 'new' | 'removed' | 'success'
      displayConditions:       # object, OPTIONAL
      dynamicProperties:       # { function: <fn-key> }, OPTIONAL
        function: <fn-key>
```

`dynamicProperties` (documenté) :
- handler `(payload) => { status: {...} }` ; payload =
  `{ cloudId, extension: { type: "jira:issueContext", issue: { id, type, key, typeId }, project: { id, type, key } } }`.
- Appelé au 1er rendu (1re ouverture du panneau), puis **à chaque repli** du panneau pour rafraîchir `status`.
- Icône dynamique : permission de source requise ; formats autorisés par défaut
  `resource:<resource key>;<relative path>` et `data:image` URIs. Sans permission → config par défaut.

Le module est aussi déclarable en **dynamic module** (`POST/PUT /forge/installation/v2/dynamic/module/`).

### Exemple minimal copiable (doc)

```yaml
modules:
  jira:issueContext:
    - key: hello-world-issue-context
      resource: main
      resolver:
        function: resolver
      render: native
      title: Hello World!
      description: A hello world issue context.
      label: Hello World!
```

> ⚠️ Écart doc : l'exemple officiel contient `description`, **absent du tableau Properties** → **non documenté**.

### Câblage code

- `render: native` + `resource` + `resolver.function`.
- Contexte : `useProductContext().extension` → `type`, `issue.id`, `issue.key`, `issue.type`, `issue.typeId`,
  `project.id`, `project.key`, `project.type`, `location`.
- « Extension context » (table séparée) : `type` seul.
- « Platform context » (table séparée) : `issueId`, `issueKey`, `issueType`, `issueTypeId`, `projectId`,
  `projectKey`, `projectType`.
- Événement front : `events.on("JIRA_ISSUE_CHANGED", data)` avec
  `{ issueId, projectId, changes: [{ changeType: "updated"|"commented", atlassianId }] }`.
  Limite documentée : « up to a few seconds » de délai. Si plusieurs modules de vue issue :
  préférer le module *Issue view background script*.

---

## 3. `jira:projectSettingsPage`

Item dans la sidebar **Project settings** du projet. Utilisable en **Jira et JSM**.
URL construite : `/jira/software/projects/{projectKey}/settings/apps/{appId}/{envId}`.
À déclarer comme composant de **premier niveau**.

### Structure YAML

```yaml
modules:
  jira:projectSettingsPage:
    - key:                     # string, MANDATORY. regex ^[a-zA-Z0-9_-]+$
      resource:                # string, MANDATORY si Custom UI / UI Kit moderne
      render: native           # 'native', MANDATORY si UI Kit moderne
      resolver:                # MANDATORY
        function: <fn-key>     #   ou endpoint: <remote-key>
      title:                   # string | i18n, MANDATORY (titre de page + item de la sidebar)
      icon:                    # string, OPTIONAL. chemin relatif depuis une ressource OU URL absolue
      layout: native           # OPTIONAL, défaut native.
                               #   UI Kit : native | basic
                               #   Custom UI : native | blank | basic (deprecated)
      pages:                   # Page[], OPTIONAL. XOR avec sections
        - title:               #   string | i18n, MANDATORY
          route:               #   string, MANDATORY
          icon:                #   string, OPTIONAL
          displayConditions:   #   object, OPTIONAL
      sections:                # Section[], OPTIONAL
        - header:              #   string | i18n, OPTIONAL
          pages:               #   Page[], MANDATORY
          displayConditions:   #   object, OPTIONAL
      displayConditions:       # object, OPTIONAL
```

Contraintes : sous-pages (`pages`/`sections`) = **Custom UI uniquement** (routage via `view.createHistory()`).

### Exemple minimal copiable (doc)

```yaml
modules:
  jira:projectSettingsPage:
    - key: hello-world-project-settings-page
      resource: main
      resolver:
        function: resolver
      render: native
      title: Hello World
```

### Câblage code

- `render: native` + `resource` + `resolver.function`.
- Contexte : `useProductContext().extension` → `type`, `project.id`, `project.key`, `project.type`, `location`.
  (Pas de `board.*` ici, contrairement à `jira:projectPage`.)

---

## 4. `jira:dashboardGadget`

Gadget affiché sur la page Dashboards. Utilisable en **Jira et JSM**.

### Structure YAML

```yaml
modules:
  jira:dashboardGadget:
    - key:                     # string, MANDATORY. regex ^[a-zA-Z0-9_-]+$
      resource:                # string, MANDATORY si Custom UI / UI Kit moderne
      render: native           # 'native', MANDATORY si UI Kit moderne
      resolver:                # MANDATORY
        function: <fn-key>     #   ou endpoint: <remote-key>
      title:                   # string | i18n | { text, href }, MANDATORY
                               #   { text, href } : le titre devient un lien
      description:             # string | i18n, MANDATORY
      thumbnail:               # string, MANDATORY. URL ABSOLUE de l'icône (liste des gadgets)
      edit:                    # OPTIONAL. expérience d'édition du gadget
        resource:              #   string, si édition en Custom UI / UI Kit moderne
        render: native         #   'native', si édition en UI Kit
      refreshable:             # boolean, OPTIONAL. false = on remplace le refresh natif de Jira
      displayConditions:       # object, OPTIONAL (visibilité dans la liste des gadgets à installer)
      connectKeys:             # string[], OPTIONAL. clés Connect remplacées au chargement
```

Contraintes / comportements documentés :
- **Auto-refresh** : intervalle en minutes fourni à l'édition via `await view.submit({ ...autresChamps, refresh: 15 })`
  (entiers positifs acceptés).
- **Refresh custom** : `refreshable: false` + `events.on('JIRA_DASHBOARD_GADGET_REFRESH', payload)`
  → `payload.origin` = `'dashboard'` ou `'gadget'`, `payload.gadgetId` (si `origin === 'gadget'`).
  L'événement est reçu par **tous** les gadgets Forge → filtrer soi-même.
- **Vue + édition sur la même ressource** : `context.extension.entryPoint === 'edit'` discrimine.
- `connectKeys` : quand non vide, seules les clés listées matchent (clé du gadget Forge exclue).
- `displayConditions` : gadget déjà ajouté et dont l'utilisateur perd le droit → message d'erreur.

### Exemple minimal copiable (doc, Custom UI — seule variante fournie)

```yaml
modules:
  jira:dashboardGadget:
    - key: hello-world-gadget
      title: Hello world!
      description: A hello world dashboard gadget.
      thumbnail: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg
      resource: main
      resolver:
        function: resolver
      edit:
        resource: main
resources:
  - key: main
    path: static/hello-world/build
```

Variante UI Kit — **assemblée** des propriétés documentées (`render` + `edit.render`) ; la page ne fournit
**aucun exemple UI Kit complet** :

```yaml
modules:
  jira:dashboardGadget:
    - key: hello-world-gadget
      title: Hello world!
      description: A hello world dashboard gadget.
      thumbnail: https://example.com/thumb.svg
      resource: main
      render: native
      resolver:
        function: resolver
      edit:
        resource: main
        render: native
```

### Câblage code

- Contexte (table « Extension context ») : `gadgetConfiguration`, `dashboard.id`, `gadget.id`, `type`,
  `location`. **`useProductContext()` n'est pas cité par cette page** : l'accès UI Kit au contexte du gadget
  est **non documenté ici** (seul `view.getContext()` apparaît, côté Custom UI).
- Édition : `view.submit({ ..., refresh: <minutes> })`.

---

## 5. `app.compatibility` (Jira requis, Confluence optionnel)

Source : https://developer.atlassian.com/platform/forge/app-compatibility/ — *Last updated Oct 30, 2026*

- **Mono-app** : aucune déclaration nécessaire (l'app est installable uniquement dans l'app visée).
- **Multi-app** : déclaration obligatoire sous `app:`. Seuls **Jira et Confluence** sont supportés ;
  **exactement une** app est `required`, les autres `required: false` (autant d'optionnelles qu'on veut).
- L'`installationId` est **partagé** entre app requise et optionnelles. L'app requise gouverne
  installation / upgrade / désinstallation, **le stockage et la Data Residency** (toutes les données
  sont épinglées sur la région de l'app requise). Désinstaller l'app requise désinstalle tout.
- Contraintes : listing Marketplace **payant uniquement** (pas de gratuit) ; on ne peut changer/retirer
  l'app requise que s'il n'existe **aucune installation** ; une seule app requise maximum ;
  changement d'app requise = version **mineure** sauf si permissions/egress ajoutés.
- Une fois déployé, impossible de passer de « liens optionnels seulement » à « lien requis » (ou l'inverse),
  et impossible de retirer l'objet `compatibility` du manifest → choisir **avant** de déployer.
- Global Apps (EAP) : `compatibility: {}` = aucune app liée, ou uniquement des `required: false`.

Bloc demandé (Jira requis, Confluence optionnel) :

```yaml
app:
  id: '<app id>'
  compatibility:
    jira:
      required: true
    confluence:
      required: false
```

(L'exemple officiel de la page inverse les rôles : `confluence: required: true` + `jira: required: false`.)

---

## 6. `resources` nécessaires aux modules UI Kit 2

Source : https://developer.atlassian.com/platform/forge/manifest-reference/resources/ — *Last updated Sep 24, 2026*

| Propriété | Type | Required | Contrainte |
|---|---|---|---|
| `key` | string | **Yes** | unique dans le manifest, **max 23 caractères**, regex `^[a-zA-Z0-9_-]+$` |
| `path` | string | **Yes** | UI Kit : chemin relatif du fichier source depuis la racine de l'app (ex. `src/frontend/index.jsx`) — ou du dossier source si `entry` est utilisé. Custom UI : dossier de statiques avec `index.html` |
| `entry` | object | No | points d'entrée nommés (max **50** par ressource), fichiers **à la racine** du `path` (pas de sous-chemin). Référence côté module : `resource: <resource-key>/<entry-key>` |
| `bundler` (Preview) | string | No | `manual@2026` = opt-out du bundling CLI, `path` pointe un dossier pré-buildé |

Déclaration type pour les 4 modules ci-dessus :

```yaml
resources:
  - key: main
    path: src/frontend/index.jsx
```

Variante multi-entrées (partage de dépendances, supportée pour les modules Jira) — chaque module pointe
`resource: app/<entry-key>` :

```yaml
resources:
  - key: app
    path: src/frontend/
    entry:
      project: project.jsx
      issue: issue.jsx
```

Notes doc : pour UI Kit, la plateforme **bundle et héberge** les sources et rend nativement via `@forge/react` ;
« UI Kit allows only images » comme ressources statiques (pas de HTML/CSS/JS arbitraires). Les icônes bundlées
s'écrivent `resource:<resource key>;<relative path>`.

---

## 7. Récapitulatif express

| Module | UI Kit 2 | `title` | Contexte `extension` | Spécifique |
|---|---|---|---|---|
| `jira:projectPage` | `render: native` + `resource` + `resolver` | requis | `project.*`, `board.*` (JSW), `location` | `pages`/`sections` (Custom UI only), `layout`, `icon` |
| `jira:issueContext` | idem | requis | `issue.*`, `project.*`, `location` | `label` requis, `status`, `dynamicProperties`, `JIRA_ISSUE_CHANGED` |
| `jira:projectSettingsPage` | idem | requis | `project.*`, `location` | `pages`/`sections` (Custom UI only), `layout`, `icon` |
| `jira:dashboardGadget` | idem (+ `edit.render`) | requis | `gadgetConfiguration`, `dashboard.id`, `gadget.id`, `location` | `description` + `thumbnail` requis, `refreshable`, `connectKeys`, refresh via `view.submit` |

Non documenté (à ne pas supposer) : contrat de props du composant React pour ces modules ; `description` sur
`jira:issueContext` ; accès `useProductContext()` au contexte du dashboard gadget ; support des sous-pages
en UI Kit ; comportement de `icon` en chemin de ressource pour `jira:issueContext` (URL absolue exigée).
