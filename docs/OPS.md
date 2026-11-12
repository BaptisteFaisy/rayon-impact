# Exploitation — Rayon d'impact

Ce document décrit l'infrastructure autour du dépôt : la CI self-hosted, les
runners, la file de merge, les agents de conflit, et le déploiement de l'app
Forge.

## 1. La CI en 5 minutes

Le verdict de la CI doit tomber en **5 minutes maximum** (règle CI du
24 octobre). Chaque job porte `timeout-minutes: 5`, un groupe `concurrency`
annule le run précédent, et `actions/checkout` clone avec `fetch-depth: 1`.

Le job `ci` enchaîne : détection des changements TypeScript, types
(`tsc --noEmit`), tests unitaires (`vitest run`), contrôle des documents
(UTF-8, non vides), absence de marqueur de conflit, et tests des gardes
elles-mêmes (`couche0`, agents de conflit et de périmètre). Trois checks sont
exigés par le ruleset de `main` : `ci`, `ci-budget`, `couche0`.

`tsc` et `vitest` ne tournent que si un fichier TypeScript, `package.json`,
`package-lock.json`, `tsconfig.json` ou `vitest.config.ts` a changé : sur un
runner partagé et chargé, ces deux pas suffisent à faire dépasser le budget
pour une PR qui ne modifie qu'un workflow ou un script.

## 2. Les runners

Trois workers self-hosted tournent sur le serveur r630
(`baptiste@100.124.18.48`), en unités systemd utilisateur (pas de sudo) :

| Runner | Dossier | Label | Rôle |
|---|---|---|---|
| `r630-rayon-impact-01` | `actions-runner-rayon-impact-01` | `rayon-impact-worker`, `ci-node` | CI des PR, spéculation Mergify |
| `r630-rayon-impact-02` | `actions-runner-rayon-impact-02` | idem | CI des PR, spéculation Mergify |
| `r630-rayon-impact-03` | `actions-runner-rayon-impact-03` | idem | CI des PR, balayeur |

Le worker `-01` a été **déplacé** depuis le dépôt `isee-prive` (dormant) avec
l'outil `deplace-runner.sh` du kit `hermes-port` : le dossier est réutilisé,
l'ancien enregistrement est rendu, `_work/` est vidé (aucune donnée d'un autre
dépôt ne reste sur le disque partagé). Piège connu : `bin/` et `externals/` sont
des liens **absolus** vers l'ancien chemin, ils pendent après le `mv`.

Attention au nom du dossier de travail : il suit le suffixe du runner
(`_work1`, `_work2`, `_work3`), pas `_work01`. Pré-chauffer le mauvais dossier
ne sert à rien et coûte 1,1 Go.

### Node sur les runners

Node 22 est installé dans `~/node-v22.23.4-linux-x64` et lié dans `~/bin`. Les
unités systemd utilisateur n'héritent pas de `~/bin` dans leur `PATH` : le
workflow l'ajoute explicitement avec `echo "$HOME/bin" >> "$GITHUB_PATH"`.

### Pré-chauffage des dépendances (obligatoire)

Une installation à froid coûte **18 à 21 minutes** sur r630 (1 937 paquets,
`@forge/react` tire tout Atlaskit) : elle dépasserait le budget de 5 minutes.
Le marqueur et un cache de `node_modules` vivent **hors du workspace**, dans
`~/.cache/rayon-impact-ci/`, parce qu'un checkout frais (branche spéculative de
la file Mergify) vide le dossier de travail :

```bash
# sur r630, pour chaque worker (1, 2, 3)
d=/home/baptiste/actions-runner-rayon-impact-0N/_workN/rayon-impact/rayon-impact
mkdir -p "$d" && cd "$d"
cp /tmp/package.json /tmp/package-lock.json .
export PATH=/home/baptiste/bin:$PATH NPM_CONFIG_CACHE=/home/baptiste/.npm-ci-cache
npm ci --prefer-offline --no-audit --no-fund
S=/home/baptiste/.cache/rayon-impact-ci
K=$(printf '%s' "$d" | sha256sum | cut -c1-12)
mkdir -p "$S"
sha256sum package-lock.json | cut -d' ' -f1 | tr -d '\n' > "$S/$K.lock-hash"
cp -al node_modules "$S/$K.node_modules"
```

Le workflow compare l'empreinte de `package-lock.json` au marqueur et restaure
`node_modules` par liens durs depuis le cache si le workspace a été vidé. Run
sur cache chaud : **1 seconde** pour le pas « Dépendances ».

## 3. La file de merge

Mergify tient la file (`.mergify.yml`) : lots de 3, `rebase`, spéculation bornée
à 2 checks parallèles pour ne pas affamer la CI des PR. Le produit **Merge
Queue** est activé par API (`PUT /v1/products`), l'app GitHub est installée en
« All repositories ».

Le ruleset de `main` impose : PR obligatoire, historique linéaire, les trois
checks requis, et Mergify exempté de contournement.

Le balayeur `pr-auto-merge` traite ce qu'une file ne sait pas faire : les PR en
conflit (`DIRTY`), les pannes d'infrastructure (`BLOCKED`) et les branches non
linéaires. Il ne se réveille que sur : push sur `main`, fin du workflow `CI`,
édition d'une PR, et son cron `*/5`. Un commit vide ne déclenche donc rien —
pour rejouer l'agent de conflit, éditer le corps de la PR ou rejouer un run du
balayeur.

## 4. Les agents de conflit

En cas de conflit, le balayeur appelle l'agent
`.github/fireworks/conflict_agent.py` : résolution conflit par conflit, fin du
rebase, push avec bail, compte rendu sur la PR. Les saisines sont bornées
(`quota.py` : cooldown, plafond horaire, 3 par PR en 30 min) et un compte rendu
est posé une fois par tête de PR (marqueur `<!-- agent-conflit sha=… -->`).

**Fournisseur de modèle : InferHub.** Le compte Fireworks d'origine est
suspendu (HTTP 412 sur tous les modèles) ; le basculement se fait **sans
toucher au code**, uniquement par la configuration du dépôt, car l'agent lit
`FIREWORKS_BASE_URL` et `FIREWORKS_MODEL` :

| Variable / secret | Valeur |
|---|---|
| `FIREWORKS_BASE_URL` | `https://api.inferhub.dev/v1/chat/completions` |
| `FIREWORKS_MODEL` | `combo/cheap` |
| `FIREWORKS_API_KEY` (secret) | clé InferHub `sk-airo-…` (32 caractères) |
| `FIREWORKS_AGENT_RESOLVE` | `1` (coupe-circuit : `0`) |

Les noms historiques `FIREWORKS_*` sont conservés à dessein : ce sont les
variables que lit l'agent, quel que soit le fournisseur derrière. **Piège** : si
le workflow ne transmet pas `FIREWORKS_BASE_URL`, l'agent part sur l'URL
Fireworks par défaut avec un modèle d'un autre fournisseur et reçoit une 404.

Autres secrets et variables : `AUTOMERGE_PAT` (push avec bail et auto-merge),
`MERGIFY_QUEUE=1`.

### Limite connue de l'agent

La porte de compilation (`compilation_gate.py`) ne s'applique qu'aux projets à
`gradlew` : sur un conflit de documentation, une réconciliation partielle
(marqueurs `<<<<<<<`/`>>>>>>>` restants, contenu tronqué) n'est pas arrêtée par
l'agent. Le job `ci` contrôle donc les marqueurs de conflit sur **tous** les
fichiers suivis, et refuse le merge le cas échéant.

## 5. Déployer l'app Forge

```bash
npm install -g @forge/cli        # le CLI n'est pas une dépendance du dépôt
forge lint                       # valide le manifest (nécessite forge login)
forge create                     # une fois : crée l'app et remplace app.id
forge deploy -e development      # environnement de développement
forge install --demo-site        # site de démo gratuit, 90 jours, données réalistes
forge deploy -e production       # puis forge install -e production
```

Authentification sans keychain : `FORGE_EMAIL` et `FORGE_API_TOKEN`
(token créé sur id.atlassian.com, app **Forge**, scopes recommandés). Le token
vit dans `~/.atlassian-api-token` (mode 600), jamais dans le dépôt ni en clair
dans un compte rendu.

Le manifest déclare 17 scopes (Jira, développement, JSM, Confluence, Teamwork
Graph). Les scopes du graphe exigent un **administrateur d'organisation** ; un
scope manquant ne produit pas d'erreur, il omet silencieusement les objets —
l'app le signale alors dans la couverture (`missingScopes`).

Les commandes `forge create` et `forge install` sont interactives : dans un
script, les piloter dans un pseudo-TTY (`script -qec` + réponses différées).

## 6. État vérifié en conditions réelles

Site de démonstration `one-atlas-cndz.atlassian.net`, app installée en
**production** sur Jira et Confluence. Jeu de démo du SPEC §18 créé par
`scripts/seed-demo-site.py` : projet `PAY`, version `2.4` (14 tickets, un
« En cours », un bloquant hors version, un ticket `MOBL` lié, une page
Confluence liée).

Recalcul déclenché par un vrai événement Jira (`PUT /rest/api/3/version/10100`) :

```
recompute finished { versionName: '2.4', verdict: 'no-go', confidence: 'low',
  signals: 3, codes: 'COMP-01,DEP-01,DEP-02', blocking: 2, major: 1,
  coverageCode: '0/14', coverageService: '0/14',
  narrativeFromModel: true, durationMs: 18692 }
```

La confiance basse est honnête : aucun dépôt n'est relié à ces tickets et la
correspondance composant → service n'est pas encore renseignée dans les réglages
du projet.

### Couverture réelle observée et points ouverts

Le dossier de la version 2.4 déclare honnêtement ses sources :

| Source | État | Pourquoi |
|---|---|---|
| `jira` | ok | tickets, liens, changelog lus au nom de l'app |
| `service-map` | ok | depuis la politique (écran de réglages ou `RI_DEFAULT_POLICY_JSON`) |
| `confluence` | partial | une page liée lue, les autres non résolues |
| `development` | unavailable | **aucun dépôt GitHub/Bitbucket relié au site** : `COMP-02/03`, `QUAL-01/02` restent muets |
| `teamwork-graph` | unavailable | scopes `read:graph:*` non accordés (il faut un administrateur d'organisation) |
| `jsm` | unavailable | **point ouvert** : la JQL `project IN ("ITO") AND issuetype = "[System] Incident"` répond 200 avec un token utilisateur, mais l'appel `asApp()` échoue et le collecteur le traduit en `unavailable` (il n'écrit jamais un bilan vide à la place). À instruire avec les logs détaillés de l'app. |

Conséquence assumée : la confiance reste `low` et les notes de couverture le disent
(`confidence.low.detail` : « aucun commit pour 16 tickets sur 16 »,
`coverage.service.missing` : 14 tickets sans service connu). C'est le
comportement voulu par le SPEC §15 — l'absence de donnée n'est jamais présentée
comme une bonne nouvelle.

### Politique par projet sans navigateur

`RI_DEFAULT_POLICY_JSON` (variable d'environnement de l'app) fournit la politique
utilisée tant qu'aucune politique n'est enregistrée pour le projet :

```bash
forge variables set RI_DEFAULT_POLICY_JSON \
  '{"serviceMap":[{"serviceId":"svc-checkout-api","serviceName":"checkout-api","jiraComponent":"checkout-api","jsmService":"checkout-api"}],"jsmProjectKeys":["ITO"],"waiverApprovers":["<accountId>"],"defaultWaiverHours":48}' \
  -e production
forge deploy -e production   # les variables ne s'appliquent pas aux déploiements existants
```

Une politique enregistrée via l'écran de réglages a toujours priorité. Effet
mesuré sur le site de démo : couverture services **0/16 → 2/16** et
`service-map` passé de `empty` à `ok`.

### Mesure RI-02 : 200 tickets en moins de 60 s

Exigence RI-02 du SPEC : « Calculer un dossier complet pour une version de 200
tickets en moins de 60 s, en arrière-plan ». Mesurée sur le site de démo le
12/11/2026 avec la version `2.5-perf` (200 tickets créés par
`POST /rest/api/3/issue/bulk`, 4 lots de 50) :

```
recompute finished {
  versionId: '10102', versionName: '2.5-perf', reason: 'event',
  verdict: 'no-go', confidence: 'low',
  signals: 200, blocking: 200, major: 0,
  coverageCode: '0/200', coverageService: '0/200',
  narrativeFromModel: true, durationMs: 44789
}
```

**44,8 s pour 200 tickets** : l'exigence est tenue, mais la marge est faible
(75 % du budget). La collecte est séquentielle par ticket (liens distants,
changelog) : au-delà de ~250 tickets le plafond des 60 s serait dépassé. Trois
pistes déjà identifiées — paralléliser la collecte par lots, mettre en cache les
liens distants et le changelog entre deux recalculs rapprochés, et n'aller
chercher le changelog que pour les signaux qui en ont besoin (COMP-04, QUAL-03).

Piège observé : déclencher le recalcul **immédiatement** après une création en
masque ne remonte que 12 tickets sur 200 (retard d'indexation de la recherche
Jira). Attendre quelques minutes, ou vérifier le compte par JQL avant de mesurer.

