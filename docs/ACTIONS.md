# Les 9 actions Rovo / MCP (SPEC §10)

Toutes déclarées une seule fois dans `src/actions/registry.ts` (table `ACTIONS`,
ordre `ACTION_KEYS`) et consommées par trois voies : le resolver Forge
(`src/index.ts`, donc les écrans), les modules `action` du manifest (agent
Rovo) et le module `rovo:mcp` (client MCP externe). Chaque action est une
fonction Forge ordinaire `(payload, context)` — `handler: index.dispatch`.

## Tableau des actions

| Clé | Verbe | Entrées | Retour | Qui peut l'appeler |
|---|---|---|---|---|
| `get-release-impact` | GET | `projectKey`, `versionName` | Avis, confiance, synthèse, compte des signaux | Écrans, agent Rovo, MCP |
| `list-release-signals` | GET | `versionId`, `severity` (opt.) | Signaux détaillés avec preuves | Écrans, agent Rovo, MCP |
| `explain-signal` | GET | `signalId` | Constat, raison, levée possible, dérogation vivante | Écrans, agent Rovo, MCP |
| `list-impacted-teams` | GET | `versionId` | Équipes, services, tickets liés | Écrans, agent Rovo, MCP |
| `simulate-without` | GET | `versionId`, `issueKeys` (CSV) | Avis recalculé, ensemble minimal à retirer (RI-13) | Écrans, agent Rovo, MCP |
| `get-release-outcome` | GET | `versionId` | Décision prise et bilan 72 h | Écrans, agent Rovo, MCP |
| `record-decision` | CREATE | `versionId`, `decision` (`ship`\|`hold`\|`delay`), `note` (opt., ≤ 500 car.) | Décision enregistrée + avis du moment + `verdictChanged` | Écrans, agent Rovo, MCP |
| `request-waiver` | CREATE | `signalId`, `reason`, `hours` | Dérogation créée ou refus motivé (RI-07) | Écrans, agent Rovo, MCP |
| `close-waiver` | CREATE | `waiverId`, `reason` | Dérogation close ou refus motivé | Écrans, agent Rovo, MCP |

Les entrées d'action n'acceptent que des chaînes, entiers, nombres et
booléens (R2 §1.2) : les listes voyagent en CSV (`issueKeys`).

## Ce que l'agent Rovo et un client MCP peuvent faire

- **Agent Rovo** (`rovo:agent` → `actions:`) : poser le diagnostic complet
  (« peut-on livrer 2.4 ? »), expliquer chaque signal avec ses preuves,
  simuler sans des tickets, **enregistrer la décision humaine (RI-08)**,
  demander/clore une dérogation avec motif. L'agent ne calcule rien lui-même :
  il appelle les actions et restitue leurs résultats avec les liens.
- **Client MCP** (`rovo:mcp` → `tools:`) : les 9 mêmes outils — par exemple un
  agent de code externe qui vérifie si son ticket retient une version avant de
  fusionner, ou un outillage d'astreinte qui enregistre un `hold`.
- En lecture comme en écriture, tout passe par le **dernier dossier
  enregistré** (SPEC §12) : aucune action ne collecte en direct, l'agent
  répond exactement ce que les écrans affichent (SPEC §17.7).

## Identité et autorisation

- L'identité de l'appelant vient du **contexte Forge**
  (`context.principal.accountId` → `deps.viewer`), **jamais des entrées**
  (R2 §2.3). `record-decision` grave `decidedBy = viewer.accountId` : un
  payload contenant `decidedBy` ou `verdict` est ignoré.
- L'avis enregistré dans une décision (`verdictAtDecision`) est celui du
  dossier au moment de l'appel — jamais une valeur fournie par le LLM.
- Les droits de dérogation viennent de la politique du projet
  (`waiverApprovers`, rôle projet) : refus **motivé** renvoyé comme donnée,
  pas comme échec plateforme.
- Traçabilité (SPEC §15) : décisions et dérogations ne sont **jamais
  supprimées** ; `record-decision` n'ajoute que des entrées, et
  `latestDecision` rend la plus récente.

## À câbler (manifest.yml — hors de ce worktree)

1. Fonction Forge, à côté des autres `fn-*` (même forme) :

```yaml
    - key: fn-record-decision
      handler: index.dispatch
```

2. Module `action`, après `get-release-outcome` (description < 255 caractères) :

```yaml
    - key: record-decision
      name: Record release decision
      function: fn-record-decision
      actionVerb: CREATE
      description: "Records the human decision (ship, hold or delay) on a release version, with the verdict of the saved dossier at that moment and an optional note. Identity comes from the Forge context. Decisions are kept forever, never deleted."
      inputs:
        versionId:
          title: "Version id"
          type: string
          required: true
          description: "Identifier of the release version."
        decision:
          title: "Decision"
          type: string
          required: true
          description: "One of: ship, hold or delay."
        note:
          title: "Note"
          type: string
          required: false
          description: "Optional note recorded with the decision, up to 500 characters."
```

3. Ajouter `- record-decision` dans `rovo:agent[0].actions` **et** dans
   `rovo:mcp[0].tools` (après `get-release-outcome`).

4. Écran : brancher `DecisionDialog` (`src/ui/components/DecisionDialog.tsx`)
   dans `src/ui/projectPage.tsx` (composant `Dossier`), sur le modèle de
   `WaiverDialog` — état `deciding`, bouton « Enregistrer la décision » près
   du bandeau d'avis, props `{ versionId, verdict: snapshot.verdict, locale,
   onDone, onCancel }` avec rechargement du dossier dans `onDone`.

5. i18n (`src/i18n/index.ts`) : ajouter les clés `decision.dialog.*` et
   `decision.option.*` (EN + FR) listées dans le compte rendu du lot.
