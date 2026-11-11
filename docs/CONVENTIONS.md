# Conventions de code — Rayon d'impact (à lire par tout agent qui écrit du code ici)

Projet : app **Atlassian Forge** pour Jira, « Rayon d'impact d'une release »
(Codegeist 2026). Cahier des charges : `docs/SPEC.md`. Dépôt local :
`/home/baptiste/Bureau/rayon-impact`.

## 1. Règles dures (non négociables)

- **Fichiers < 500 lignes**, **fonctions < 50 lignes**. Au-delà : découper.
- **Zéro duplication** : un helper existe dans `src/signals/context.ts` ou
  `src/types.ts` → l'utiliser, jamais le recopier.
- **Ne jamais modifier les fichiers partagés** (colonne vertébrale) :
  `src/types.ts`, `src/signals/registry.ts`, `src/signals/context.ts`,
  `src/i18n/index.ts`, `tests/fixtures/builders.ts`, `tests/fixtures/paiements.ts`,
  `package.json`, `tsconfig.json`, `vitest.config.ts`.
  Un besoin d'évolution → le signaler dans le compte rendu, ne pas éditer.
- **Ne pas déléguer** : l'agent fait le travail lui-même.
- Après 3 échecs identiques sur une même commande : s'arrêter et répondre KO
  avec l'erreur exacte.

## 2. Architecture

Deux mondes étanches :

1. **Domaine pur** (`src/types.ts`, `src/signals/*`, `src/engine/*`) : aucun
   import Forge, aucune E/S, aucune horloge réelle (`now` est injecté via
   `DetectionContext`). Tout est testable hors runtime Forge.
2. **Adaptateurs Forge** (`src/db/*`, `src/collect/*`, `src/triggers/*`,
   `src/actions/*`, `src/ui/*`, `src/index.ts`) : seuls ces modules importent
   `@forge/api`, `@forge/react`, `@forge/resolver`, `@forge/llm`.

Imports relatifs **sans extension** (`import type { X } from '../types';`) : le
bundler webpack de Forge ne résout pas `./types.js` vers `types.ts` (erreur
`Module not found` au `forge deploy`). Types uniquement → `import type`.

`tsconfig.json` ne doit **pas** porter `noEmit: true` : ts-loader n'émettrait
rien et le bundle échouerait (`TypeScript emitted no output`). Le typecheck
passe le drapeau en ligne de commande (`npm run typecheck` → `tsc --noEmit`).

`@forge/sql` s'importe **statiquement** : un `import(specificateurVariable)`
provoque « Critical dependency: the request of a dependency is an expression »
et le module manque à l'exécution.

## 3. Texte et i18n

Aucune chaîne destinée à l'utilisateur en dur : toujours un `MessageRef`
(`{ key, params }`) résolu par `t(ref, locale)` de `src/i18n/index.ts`.
Les clés existent déjà ; **ne pas inventer de clé**, utiliser celles-ci :

| Signal | finding (params) |
|---|---|
| COMP-01 | `signal.comp01.finding` (`key`, `status`, `category`) |
| COMP-02 | `signal.comp02.finding` (`key`) |
| COMP-03 | `signal.comp03.finding` (`key`, `count`) |
| COMP-04 | `signal.comp04.finding` (`key`, `hours`) |
| QUAL-01 | `signal.qual01.finding` (`key`, `count`) |
| QUAL-02 | `signal.qual02.finding` (`key`, `count`) |
| QUAL-03 | `signal.qual03.finding` (`key`) |
| DEP-01 | `signal.dep01.finding` (`key`, `blockerKey`, `blockerStatus`) |
| DEP-02 | `signal.dep02.finding` (`key`, `targetKey`, `projectKey`) |
| DEP-03 | `signal.dep03.finding` (`service`) |
| EXP-01 | `signal.exp01.finding` (`incidentKey`, `service`, `issues`) |
| EXP-02 | `signal.exp02.finding` (`incidentKey`, `days`, `service`) |
| EXP-03 | `signal.exp03.finding` (`date`, `freezeName`, `from`, `to`) |
| EXP-04 | `signal.exp04.finding` (`siblingVersion`, `date`, `service`) |
| DOC-01 | `signal.doc01.finding` (`pageTitle`, `cycleStart`) |
| HIST-01 | `signal.hist01.finding` (`service`, `count`) |
| OBJ-01 | `signal.obj01.finding` (`milestone`, `due`) |

`title` / `why` / `clear` viennent du registre
(`getSignalDefinition(code)`), jamais recopiés dans un détecteur.
Un paramètre manquant ou mal nommé → adapter le code aux paramètres existants
et le signaler au compte rendu.

## 4. Signaux : contrat commun

Chaque famille de signaux exporte un tableau de `Detector`
(`(ctx: DetectionContext) => Signal[]`) et construit ses signaux avec
`makeSignal(ctx, { code, subject, finding, evidence })`. Règles :

- Gravité effective = `effectiveSeverity(code, policy)` (déjà dans `makeSignal`).
- Signal désactivé par la politique → ne rien produire (`isSignalEnabled`).
- **Donnée absente ≠ bonne nouvelle** (SPEC §15) : si une source est
  `unavailable`/`empty`, le détecteur ne produit rien et la couverture le dit.
- Preuve : au moins une `Evidence` avec `url` quand la source en fournit une.
- Identifiants stables : `subjectId` = id Jira (`issue.id`, `incident.id`, …).

## 5. Tests

- Vitest, fichiers `tests/<zone>/<module>.test.ts`, aucun réseau, aucune E/S.
- Composer les jeux de données avec `tests/fixtures/builders.ts` et le jeu
  canonique `tests/fixtures/paiements.ts` — jamais de littéraux recopiés.
- Couvrir : cas nominal, cas limite (SPEC §16), et le cas « donnée absente ».
- Assertions sur les **clés** et les **params** des `MessageRef`, pas sur du
  texte traduit.
- Recette SPEC §17 : chaque point doit être couvert par un test nommé
  explicitement (`it('acceptance §17.1 …')`).

## 6. Vérification avant de rendre

```bash
cd /home/baptiste/Bureau/rayon-impact
npx tsc --noEmit            # ne tolérer que les erreurs hors de son périmètre
npx vitest run tests/<zone> # tout doit passer
wc -l <fichiers écrits>     # < 500 lignes chacun
```

Compte rendu attendu : liste des fichiers écrits avec leur `wc -l`, résultat de
`tsc` et de `vitest`, écarts éventuels avec les conventions, besoins non
couverts par la colonne vertébrale.
