# Preuves — capture du live

Capturé le **2026-11-12T15:39:36Z** depuis l'environnement **production**.

## Déploiements

| environnement | dernier déploiement |
| --- | --- |
| development | 2026-11-12T13:22:13.177Z |
| production | 2026-11-12T13:23:39.765Z |
| staging | 2026-11-11T10:21:23.250Z |

## Surface applicative

Version majeure listée par Forge (environnement de développement) : **3**, déployée le 2026-11-11T21:01:00.226Z — 15 fonctions, 17 scopes. Forge ne liste que les versions majeures, sur l'environnement de développement : la production est attestée par la date de déploiement ci-dessus et par le webtrigger qui répond.

## Contrôles

| contrôle | statut | détail |
| --- | --- | --- |
| Dossier calculé par la production | **OK** | computedAt=2026-11-12T15:39:59.000Z version=2.4 signaux=4 |
| Avis et confiance dans l'énumération du SPEC | **OK** | avis=no-go confiance=low comptes={"blocking": 3, "major": 1, "minor": 0, "info": 0} |
| Aucune clé de ticket inventée par la synthèse | **OK** | 7 clé(s) citée(s), 0 hors signaux |
| État de chaque source de couverture | **OK** | jsm=partial, confluence=empty, teamwork-graph=unavailable, jira=ok, development=unavailable, service-map=ok |
| Décisions et dérogations réellement enregistrées | **INFO** | décisions=0 dérogations=0 bilan 72 h=non |
| Chaîne de déclenchement dans les journaux de production | **OK** | 3 ligne(s) de chaîne dans les 40 dernières lignes de journal |

## Modules

- `action` : 9
- `consumer` : 1
- `jira:dashboardGadget` : 1
- `jira:issueContext` : 1
- `jira:projectPage` : 1
- `jira:projectSettingsPage` : 1
- `llm` : 1
- `rovo:agent` : 1
- `rovo:mcp` : 1
- `scheduledTrigger` : 2
- `sql` : 1
- `trigger` : 3
- `webtrigger` : 1

## Historique des dossiers

| calculé | version | avis | signaux |
| --- | --- | --- | --- |
| 2026-11-12T15:39:59.000Z | 2.4 | no-go | 4 |
| 2026-11-12T15:36:09.000Z | 2.4 | no-go | 4 |
| 2026-11-12T15:34:43.000Z | 2.4 | no-go | 4 |
| 2026-11-12T15:19:09.000Z | 2.5-perf | no-go | 200 |
| 2026-11-12T15:19:09.000Z | 2.4 | no-go | 4 |
| 2026-11-12T14:19:07.000Z | 2.5-perf | no-go | 200 |
| 2026-11-12T14:19:07.000Z | 2.4 | no-go | 4 |
| 2026-11-12T13:27:54.000Z | 2.4 | no-go | 4 |

## Chaîne de déclenchement (journaux de production)

```
INFO    2026-11-12T15:39:57.218Z ead82368-2aa1-4048-b251-5a989ac4a790 [rayon-impact] recompute queued { versionId: '10100', reason: 'event' }
INFO    2026-11-12T15:39:57.682Z 932024a4-49ca-4009-946b-4d89af19222c [rayon-impact] recompute started {
INFO    2026-11-12T15:40:04.864Z 932024a4-49ca-4009-946b-4d89af19222c [rayon-impact] recompute finished {
```
