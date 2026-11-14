# Démo hors ligne — « Rayon d'impact »

Une démo qui joue **l'app réelle** sans site Jira, sans modèle et sans réseau.

Rien n'est réécrit pour la démo : ce sont le pipeline de recalcul
(`src/engine/pipeline.ts`), les résolveurs d'écran (`src/screens.ts`) et les
neuf actions Rovo/MCP (`src/actions/registry.ts`) du dépôt qui répondent. Seuls
les ports changent — la collection vient des fixtures de test au lieu de Jira,
et le narrateur échoue au lieu d'appeler le modèle (le pipeline prend alors son
repli déterministe, `narrativeVerified: false`).

## Lancer

```bash
node demo/build.mjs      # bundle le code de l'app (une fois, ou après un changement)
node demo/server.mjs     # http://localhost:8791   (DEMO_PORT pour un autre port)
```

`demo/build.mjs` construit le bundle avec esbuild et remplace les deux modules
Forge par des doublures déjà présentes dans le dépôt : `@forge/react` devient le
mock de rendu HTML des tests, `@forge/bridge` devient un stub qui échoue
bruyamment (un rendu statique n'appelle jamais un résolveur).

## Les quatre releases jouables

| scénario | ce qu'il montre | verdict mesuré |
| --- | --- | --- |
| `paiements-24` | le jeu canonique : 14 tickets, 5 signaux bloquants | `no-go`, confiance haute |
| `paiements-24-video` | la variante vidéo du SPEC §18 : 12 tickets, la séquence A→E | `no-go` → `conditional-go` |
| `mobile-31` | une release saine, pour montrer un `go` | `go`, confiance haute |
| `plateforme-90` | le pire cas : 6 bloquants de 5 familles, un gel, une voisine | `no-go`, confiance haute |

Les chiffres viennent du moteur, pas d'une main : ils sont vérifiés par
`tests/demo/scenarios.test.ts` et `tests/demo/runtime.test.ts`.

## Ce qui est vérifié automatiquement

```bash
npx vitest run tests/demo            # scénarios mesurés, runtime réel, serveur bout en bout
npx tsc -p scripts/demo/tsconfig.json --noEmit   # le code de la démo, lui
```

`tests/demo/server.test.ts` construit le bundle, démarre le serveur sur un port
libre et vérifie les réponses HTTP : la démo ne peut pas pourrir en silence.
Le `tsconfig.json` de `scripts/demo/` existe parce que le `tsconfig.json` racine
est un fichier partagé non modifiable : il ne couvre que la démo, et la CI ne le
lance pas encore (ajouter un script à `package.json` et une étape à `ci.yml`
serait nécessaire — fichiers gelés par les conventions).

## Les routes

| route | ce qu'elle prouve |
| --- | --- |
| `/` | l'accueil : les quatre releases et leur verdict mesuré |
| `/s/<scénario>/project` | l'écran projet : verdict, couverture, synthèse, onglets Signaux / Graphe / Équipes / Dérogations / Historique, simulation |
| `/s/<scénario>/issue` | le panneau sous un ticket : ce ticket retient-il la version ? |
| `/s/<scénario>/settings` | l'écran de réglages : les sévérités par signal, les services, les dérogeants |
| `/s/<scénario>/gadget` | le gadget de tableau de bord : les versions et leur avis |
| `/api/<scénario>/dossier` | le dossier tel que les écrans le lisent |
| `/api/<scénario>/reads` | toutes les lectures de l'écran projet, en JSON |
| `/api/<scénario>/action?key=…&payload={…}` | une action Rovo/MCP, exécutée pour de vrai |

Paramètres d'URL : `?locale=fr|en`, `?role=lead|reader` (un lecteur n'a pas le
droit de déroger : l'action le refuse, RI-07), `?tab=signals|graph|teams|waivers|history`.

## Ce que la démo ne prétend pas

- **Les données viennent des fixtures** (`tests/fixtures/demo-scenarios.ts`),
  pas d'un site Jira : aucun écran ne lit Jira ici.
- **La synthèse est le repli déterministe**, pas un texte de modèle : le
  narrateur échoue faute de modèle, et le dossier le dit (`narrativeVerified:
  false`).
- **Une synthèse par dossier, en anglais** : le pipeline écrit une seule
  synthèse, en anglais ; un écran en français affiche donc un résumé anglais.
  C'est un écart connu de l'app (SPEC §15), annoncé sur l'écran plutôt que
  masqué.
- **`screen.issueContext` n'est pas appelé** : il lit SQL via
  `createForgeSqlClient()`, qui n'existe que dans le runtime Forge. La démo
  répond la même charge utile depuis le store en mémoire.

## Fichiers

| chemin | rôle |
| --- | --- |
| `demo/server.mjs` | le serveur : routage et flux, aucune logique métier |
| `demo/build.mjs` | le bundle esbuild et ses alias |
| `scripts/demo/entry.ts` | le point d'entrée du bundle : écrans, actions, JSON |
| `scripts/demo/views.tsx` | les écrans, montés avec les composants de production |
| `scripts/demo/shell.ts` | le chrome (barre, fil d'Ariane, feuille de style) |
| `scripts/demo/kit-mock.tsx` | le mock `@forge/react` habillé pour le navigateur |
| `tests/fixtures/demo-scenarios.ts` | les quatre scénarios, en pur domaine |
| `tests/demo/runtime.ts` | le runtime : pipeline, résolveurs et actions réels |
| `tests/demo/dataset.ts` | le jeu de données, lu dans les résolveurs |
| `scripts/demo/measure-scenarios.ts` | mesure des verdicts (console) |
