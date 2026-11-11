# ACCEPTANCE — harnais de recette automatisé (SPEC §17)

## À quoi ça sert

Sept bugs de l'app n'ont été découverts que par un **vrai recalcul sur le site
de démo** (docs/OPS.md §6). Le harnais rend ce test rejouable : il prépare les
données dans Jira, déclenche le recalcul par le même événement réel
(`PUT /rest/api/3/version/{id}`), **sonde** un webtrigger de lecture
(`src/webtrigger.ts`) en attente bornée, puis affirme les 8 points de recette
du SPEC §17 — sans navigateur.

Deux parties :

- **`src/webtrigger.ts`** : module Forge `webtrigger` en **lecture seule**
  (GET uniquement, aucune écriture, aucun recalcul). Routes : `/health`,
  `/dossier?versionId=…` (ou `?projectKey=…&versionName=…`),
  `/snapshots?projectId=…[&limit=]`. Il réutilise `createStore()`
  (`src/db/repo.ts`) et `createJiraClient()` — zéro requête recopiée. Les
  webtriggers Forge ne sont **pas authentifiés par la plateforme** : le handler
  vérifie lui-même un jeton `Bearer` contre la variable d'environnement de
  l'app `RI_WEBTRIGGER_TOKEN` (comparaison à temps constant ; variable absente
  ⇒ tout refus). Réponses bornées, très loin de la limite de 55 s.
- **`scripts/acceptance/`** : Python stdlib uniquement — `client.py` (Jira
  REST + webtrigger + `poll_until` borné, jamais de sleep fixe > 30 s),
  `cases.py` (R1…R8), `run.py` (orchestration), `report.py` (compte rendu).

## Comment le lancer

Prérequis (une fois) :

```bash
# 1. Jeton Atlassian : ~/.atlassian-api-token (mode 600) — jamais dans le dépôt.
# 2. Côté app : poser le jeton du harnais puis déployer (voir docs/OPS.md §5)
forge variables set RI_WEBTRIGGER_TOKEN=<jeton-aléatoire> -e production
forge deploy -e production
# 3. Obtenir l'URL du webtrigger (admin de l'installation) :
forge webtrigger create        # module « dossier-read »
echo 'https://<id>.webtrigger.atlassian.app/public/<ID>' > ~/.rayon-webtrigger-url
echo '<jeton-aléatoire>' > ~/.rayon-webtrigger-token && chmod 600 ~/.rayon-webtrigger-token
```

Lancement :

```bash
cd <worktree>
python3 scripts/acceptance/run.py                       # les 8 cas, défauts documentés
python3 scripts/acceptance/run.py --cases R1,R5,R6,R8   # les cas automatisables
```

Arguments (défauts entre parenthèses, surchargeables par l'environnement) :
`--site` (`RAYON_SITE`, https://one-atlas-cndz.atlassian.net), `--project`
(`RAYON_PROJECT`, PAY), `--version` (`RAYON_VERSION`, 2.4), `--webtrigger-url`
(`RAYON_WEBTRIGGER_URL` ou `~/.rayon-webtrigger-url`), `--timeout` (300 s),
`--cases` (tous). Secrets : `ATLASSIAN_API_TOKEN`/`~/.atlassian-api-token`
(+ `ATLASSIAN_EMAIL`), `RAYON_WEBTRIGGER_TOKEN`/`~/.rayon-webtrigger-token`.
**Code de sortie** : 0 si aucun ÉCHEC (les SAUTÉS ne sont pas des échecs),
1 si un cas échoue, 2 si le harnais est mal configuré.

**Idempotent** : les tickets du harnais portent le marqueur `[acc-Rn]` ; un
état dans `~/.cache/rayon-acceptance/state-<projet>-<version>.json` les
retrouve d'une relance à l'autre (recherche JQL de secours). Relancer ne
recrée rien.

## Ce que couvre chaque cas

| Cas | SPEC | Couverture |
|---|---|---|
| R1 | §17.1 | Ticket `[acc-R1]` « En cours » dans la version, PUT version, attente du nouveau `computedAt` : avis **no-go** et **COMP-01 cite ce ticket** (`finding.params.key`). |
| R2 | §17.2 | **SAUTÉ** — voir plus bas. |
| R3 | §17.3 | **SAUTÉ** — voir plus bas. |
| R4 | §17.4 | **SAUTÉ** — voir plus bas. |
| R5 | §17.5 | Confiance **low**, `issuesWithCode = 0` et `coverage.notes` non vides (le texte explique la donnée absente). Vrai tant qu'aucun dépôt n'est relié au projet (état du site de démo, OPS §6). |
| R6 | §17.6 | Ticket `[acc-R6]` bloquant vu par COMP-01, puis « Terminé » **sans toucher à la version** : le recalcul automatique (trigger `issue-updated`) lève COMP-01 en **< 120 s** (sondage 5 s, juge 120 s, SPEC « moins de 2 minutes »). |
| R7 | §17.7 | **SAUTÉ** — voir plus bas. |
| R8 | §17.8 | Sur **tous** les snapshots sauvés du projet (`/snapshots`) : chaque clé `XXX-n` citée par la synthèse apparaît dans les signaux du même snapshot. Le corpus « 20 dossiers d'essai » reste à constituer — le cas le signale dans sa raison. |

## Ce que le harnais ne peut PAS couvrir (sans navigateur)

- **R2 (§17.2, EXP-01)** : il faut une carte composant → service, qui s'écrit
  via l'écran de réglages (resolver `screen.savePolicy`) — le webtrigger est
  volontairement en lecture seule. Une fois la carte renseignée à la main,
  créer un incident JSM ouvert suffirait ; le cas est écrit pour être activé.
- **R3 (§17.3, dérogation)** : l'action `request-waiver` exige un principal
  habilité (`canWaive`) via l'écran ou l'agent — pas de route d'écriture ici.
- **R4 (§17.4, preuve masquée)** : dépend de l'identité du lecteur ; la doc
  Forge est explicite : aucune identité utilisateur n'est attachée aux appels
  webtrigger (« Atlassian user information is not attached to invocations »).
- **R7 (§17.7, agent Rovo)** : interroger l'agent exige l'interface Rovo.
- Les **4 écrans** (SPEC §11), le **dialogue de dérogation** et tout rendu
  UI Kit : aucune sonde HTTP possible.

## Interpréter un échec

1. **`ERREUR HARNAIS` (code 2)** : configuration, pas recette — `/health`
   injoignable (webtrigger non déployé / mauvaise URL), `RI_WEBTRIGGER_TOKEN`
   non posée côté app, jeton local absent, version/projet introuvable.
2. **401 sur une route de données** : le jeton local ne correspond pas à
   `RI_WEBTRIGGER_TOKEN` (les deux côtés sont comparés, le refus ne dit pas
   lequel manque).
3. **Timeout d'un sondage** : le recalcul n'est pas arrivé. Vérifier
   `forge logs` (le consumer journalise `recompute finished …`), la porte de
   regroupement (1 recalcul/min) et la file `rayon-recalc`.
4. **R1/R6 échouent avec un autre avis** : lire les `signaux : […]` de la
   raison — un signal inattendu (DEP, EXP…) peut forcer le no-go ; c'est soit
   un vrai bug, soit l'état du site qui a dérivé (autre agent, données de démo).
5. **R5 échoue** : quelqu'un a relié un dépôt ou renseigné la carte de
   services — l'hypothèse « projet sans dépôt » du §17.5 n'est plus vraie.
6. **R8 échoue** : la synthèse cite un ticket absent des signaux — bug réel de
   vérification de narrative (RI-06), à investiguer avant toute livraison.

Un cas échoué n'arrête jamais les suivants ; le compte rendu final liste
R1…R8 avec OK / ÉCHEC / SAUTÉ et la raison.
