**Fournisseur de modèle : InferHub.** Le compte Fireworks d'origine est suspendu
(HTTP 412 sur tous les modèles) ; le basculement se fait **sans toucher au code**,
uniquement par la configuration du dépôt, car l'agent lit `FIREWORKS_BASE_URL` et
`FIREWORKS_MODEL` :

| Variable / secret | Valeur |
|---|---|
| `FIREWORKS_BASE_URL` | `https://api.inferhub.dev/v1/chat/completions` |
| `FIREWORKS_MODEL` | `combo/cheap` |
| `FIREWORKS_API_KEY` (secret) | clé InferHub `sk-airo-…` (32 caractères) |
| `FIREWORKS_AGENT_RESOLVE` | `1` par défaut ; `0` pour activer le coupe-circuit et désactiver l'agent |

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
