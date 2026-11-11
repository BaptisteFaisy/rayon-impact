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
