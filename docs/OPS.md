<<<<<<< HEAD
# Exploitation — Rayon d'impact (variante CI)

Note d'exploitation centrée sur la chaîne CI et les runners self-hosted.

## 1. Budget CI

Chaque job GitHub Actions est borné à 5 minutes : `timeout-minutes: 5`,
`concurrency` avec `cancel-in-progress: true`, `actions/checkout` en
`fetch-depth: 1`. Le garde `ci-budget` refuse tout job non borné ou trop long.

## 2. Workers r630

| Runner | Label | Rôle |
|---|---|---|
| `r630-rayon-impact-01` | `rayon-impact-worker` | CI des PR, spéculation Mergify |
| `r630-rayon-impact-02` | `rayon-impact-worker` | CI des PR, spéculation Mergify |
| `r630-rayon-impact-03` | `rayon-impact-worker` | CI des PR, balayeur |

Node 22 est installé dans `~/node-v22.23.4-linux-x64` et lié dans `~/bin` ; le
workflow ajoute `~/bin` au `PATH` via `GITHUB_PATH`.

## 3. Dépendances

Le pré-chauffage est obligatoire : une installation à froid prend 18 à 21
minutes (1 937 paquets). Le workflow saute `npm ci` tant que l'empreinte de
`package-lock.json` correspond au marqueur `.npm-state/lock-hash`.

## 4. File et conflits

Mergify tient la file (lots de 3, rebase). Les conflits sont traités par le
balayeur `pr-auto-merge` et l'agent `.github/fireworks/conflict_agent.py`,
avec porte de compilation et quota de saisines.
=======
# Exploitation — Rayon d'impact

Ce document décrit l'infrastructure autour du dépôt : la CI self-hosted, les
runners, la file de merge, et le déploiement de l'app Forge.

## 1. La CI en 5 minutes

Le verdict de la CI doit tomber en **5 minutes maximum** (règle du 24 octobre).
Chaque job porte `timeout-minutes: 5`, un groupe `concurrency` annule le run
précédent, et `actions/checkout` clone avec `fetch-depth: 1`.

Le job `ci` enchaîne : types (`tsc --noEmit`), tests unitaires (`vitest run`),
contrôle des documents (UTF-8, non vides) et tests des gardes elles-mêmes
(`couche0`, agents fireworks). Trois checks sont exigés par le ruleset de
`main` : `ci`, `ci-budget`, `couche0`.

## 2. Les runners

Trois workers self-hosted tournent sur le serveur r630
(`baptiste@100.124.18.48`), en unités systemd utilisateur (pas de sudo) :

| Runner | Dossier | Label | Rôle |
|---|---|---|---|
| `r630-rayon-impact-01` | `actions-runner-rayon-impact-01` | `rayon-impact-worker`, `ci-node` | CI des PR, spéculation Mergify |
| `r630-rayon-impact-02` | `actions-runner-rayon-impact-02` | idem | CI des PR, spéculation Mergify |
| `r630-rayon-impact-03` | `actions-runner-rayon-impact-03` | idem | CI des PR, balayeur |

Le worker `-01` a été **déplacé** depuis le dépôt `isee-prive` (dormant depuis
le 27 octobre) avec l'outil `deplace-runner.sh` du kit `hermes-port` : le
dossier est réutilisé, l'ancien enregistrement est rendu, `_work/` est vidé
(aucune donnée d'un autre dépôt ne reste sur le disque partagé).

### Node sur les runners

Node 22 est installé dans `~/node-v22.23.4-linux-x64` et lié dans `~/bin`. Les
unités systemd utilisateur n'héritent pas de `~/bin` dans leur `PATH` : le
workflow l'ajoute explicitement avec `echo "$HOME/bin" >> "$GITHUB_PATH"`.

### Pré-chauffage des dépendances (obligatoire)

Une installation à froid coûte **18 à 21 minutes** sur r630 (1 937 paquets,
`@forge/react` tire tout Atlaskit) : elle dépasserait le budget de 5 minutes.
Les runners sont donc pré-chauffés **une fois**, hors CI :

```bash
# sur r630, pour chaque worker NN (01, 02, 03)
d=/home/baptiste/actions-runner-rayon-impact-NN/_workNN/rayon-impact/rayon-impact
mkdir -p "$d" && cd "$d"
cp /tmp/package.json /tmp/package-lock.json .
export PATH=/home/baptiste/bin:$PATH NPM_CONFIG_CACHE=/home/baptiste/.npm-ci-cache
npm ci --prefer-offline --no-audit --no-fund
mkdir -p .npm-state
sha256sum package-lock.json | cut -d' ' -f1 | tr -d '\n' > .npm-state/lock-hash
```

Le workflow compare ensuite l'empreinte de `package-lock.json` au marqueur
`.npm-state/lock-hash` et **saute l'installation** tant que le verrou n'a pas
changé. Le marqueur vit hors de `node_modules` : `npm ci` efface ce dossier.
Un run sur cache chaud dure ~40 s ; une installation incrémentale (un paquet
ajouté) ~20 s.

Après chaque changement de `package-lock.json`, relancer le pré-chauffage sur
les trois workers (ou laisser la CI installer, une seule fois, en acceptant un
run long hors PR).

## 3. La file de merge

Mergify tient la file (`.mergify.yml`) : lots de 3, `rebase`, spéculation
bornée à 2 checks parallèles pour ne pas affamer la CI des PR. Le produit
**Merge Queue** est activé par API (`PUT /v1/products`), l'app GitHub est
installée en « All repositories ».

Le ruleset de `main` impose : PR obligatoire, historique linéaire, les trois
checks requis, et Mergify exempté de contournement.

Le balayeur `pr-auto-merge` traite ce qu'une file ne sait pas faire : les PR en
conflit (`DIRTY`), les pannes d'infrastructure (`BLOCKED`) et les branches non
linéaires.

## 4. Les agents de conflit

En cas de conflit, le balayeur appelle l'agent
`.github/fireworks/conflict_agent.py` : résolution conflit par conflit, fin du
rebase, push avec bail, compte rendu sur la PR. Une résolution qui ne compile
pas n'est jamais poussée (`compilation_gate.py`). Les saisines sont bornées
(`quota.py` : cooldown, plafond horaire, 3 par PR en 30 min).

**Fournisseur de modèle : InferHub.** Le compte Fireworks d'origine est suspendu
(HTTP 412 sur tous les modèles) ; le basculement se fait **sans toucher au code**,
uniquement par la configuration du dépôt, car l'agent lit `FIREWORKS_BASE_URL` et
`FIREWORKS_MODEL` :

| Variable / secret | Valeur |
|---|---|
| `FIREWORKS_BASE_URL` | `https://api.inferhub.dev/v1/chat/completions` |
| `FIREWORKS_MODEL` | `combo/cheap` |
| `FIREWORKS_API_KEY` (secret) | clé InferHub `sk-airo-…` (32 caractères) |
| `FIREWORKS_AGENT_RESOLVE` | `1` (coupe-circuit : `0`) |

Les noms historiques `FIREWORKS_*` sont conservés à dessein : ce sont les
variables que lit l'agent, quel que soit le fournisseur derrière.

Autres secrets et variables : `AUTOMERGE_PAT` (push avec bail et auto-merge),
`MERGIFY_QUEUE=1`.

## 5. Déployer l'app Forge

```bash
npm install -g @forge/cli        # le CLI n'est pas une dépendance du dépôt
forge lint                       # valide le manifest hors ligne
forge create                     # une fois : crée l'app et remplace app.id
forge deploy                     # déplore l'environnement de développement
forge install --upgrade          # après tout changement de scopes ou de modules
```

Le manifest déclare 17 scopes (Jira, développement, JSM, Confluence, Teamwork
Graph). Les scopes du graphe exigent un **administrateur d'organisation** ; un
scope manquant ne produit pas d'erreur, il omet silencieusement les objets —
l'app le signale alors dans la couverture (`missingScopes`).

Avant le premier déploiement : créer les tables avec le `migrationRunner`
(DDL idempotent dans `src/db/schema.ts`), puis charger le jeu de démonstration
(`docs/DEMO-DATA.md`).
>>>>>>> 093c206 (Docs : exploitation (CI 5 min, runners, prechauffage, file, agents de conflit, deploiement))
