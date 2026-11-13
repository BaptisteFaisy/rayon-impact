# Preuves — chaque étape, son élément de preuve

Principe : **aucune étape n'est annoncée sans preuve datée**. Les preuves sont
produites par un outil, pas narratives à la main :

```bash
python3 scripts/preuves/capture.py                # preuve de l'état live
python3 scripts/preuves/capture.py --avec-recette # + le compte rendu du harnais §17
```

La capture écrit `docs/preuves/dernier.md` (lisible) et `docs/preuves/dernier.json`
(machine), sans jamais écrire de secret : le jeton n'est pas copié, et l'URL du
webtrigger n'est conservée que sous son hôte.

Ce que la capture contrôle, à chaque fois :

| contrôle | ce qu'il prouve |
| --- | --- |
| déploiements | que `production`, `development` et `staging` ont bien été déployés, et quand |
| surface applicative | le nombre de modules, de fonctions et de scopes réellement publiés (9 actions, 4 écrans, 1 agent, 1 MCP, 1 consumer, 3 déclencheurs, 2 déclencheurs planifiés) |
| webtrigger | que l'app est **installée** : une app déployée sans installation n'a pas de jeton configuré, donc `/health` ne répondrait pas |
| dossier frais | que le dossier lu vient de la table de production, avec son horodatage de calcul |
| verdict cohérent | que l'avis et la confiance sont dans les énumérations du SPEC |
| synthèse vérifiée | que **chaque clé de ticket citée par la synthèse existe dans les signaux** — le LLM n'invente rien |
| couverture honnête | l'état de chaque source (jira, jsm, confluence, development, service-map, teamwork-graph) : une source absente est nommée, jamais silence |
| décisions et dérogations | ce que le chemin d'écriture a réellement laissé en base |
| chaîne de déclenchement | dans les journaux de production : événement → mis en file → démarré → terminé (et reporté / passe finale) |
| historique | les derniers dossiers calculés, avec leur nombre de signaux |

## Les étapes de la recette SPEC §17

Compte rendu du dernier passage (2026-11-12, production, site de démo
`one-atlas-cndz.atlassian.net`) :

```
R1 §17.1 [OK]            avis no-go, COMP-01 cite PAY-19
R2 §17.2 [SAUTÉ]         EXP-01 exige un service rattaché au ticket (écran de réglages)
R3 §17.3 [SAUTÉ]         accorder une dérogation passe par l'action request-waiver (navigateur)
R4 §17.4 [SAUTÉ]         le masquage dépend de l'identité du lecteur (navigateur)
R5 §17.5 [OK]            confiance low, couverture code 0/16, 6 note(s) de couverture l'expliquent
R6 §17.6 [OK]            recalculé sans action manuelle en 53 s (< 2 min), COMP-01 levé pour PAY-20
R7 §17.7 [SAUTÉ]         interroger l'agent Rovo (navigateur)
R8 §17.8 [OK]            50 dossier(s) vérifié(s), aucune clé hors signaux
```

| étape | preuve | statut |
| --- | --- | --- |
| R1 — avis no-go, COMP-01 cite le ticket | dossier live `computedAt`, `counts.blocking`, narrative ; capture « synthèse vérifiée » | **prouvé** |
| R2 — service rattaché au ticket | `service-map=ok` mais 2 services sur 16 : à faire dans l'écran de réglages, puis re-capturer | **à faire à la main** |
| R3 — dérogation 24 h, avis « go sous conditions » | ligne « décisions et dérogations » de la capture (0 aujourd'hui) | **à faire à la main** |
| R4 — masquage selon l'identité du lecteur | tests de masquage + dossier lu sans identité (`sanitizeDossierForViewer`) ; la preuve demande un second compte | **à faire à la main** |
| R5 — confiance basse et couverture expliquée | capture « couverture honnête » : `development=unavailable`, `codeRatio=0` | **prouvé** |
| R6 — recalcul automatique en moins de 2 min | harnais : **53 s**, sans action manuelle | **prouvé** |
| R7 — l'agent Rovo répond sur la release | dialogue Rovo du site (capture impossible sans navigateur) | **à faire à la main** |
| R8 — corpus de dossiers, aucune clé hors signaux | harnais : 50 dossiers vérifiés, 0 clé hors signaux ; capture « synthèse vérifiée » | **prouvé** |
| chaîne de production | journaux : `recompute queued` → `started` → `finished`, et `recompute deferred` / `recompute trailing` quand la fenêtre de regroupement joue | **prouvé** |
| déploiement et installation | `forge environments list` + `/health` du webtrigger | **prouvé** |

## Les quatre étapes qui demandent un navigateur

Elles passent par l'écran ou par l'agent, donc par une session humaine. La
procédure ci-dessous est **courte et vérifiable** : après chaque clic, la
capture mécanique montre l'effet, sans interprétation.

1. **R2 — rattacher un service à un ticket.**
   Jira → projet `PAY` → page de l'application → **réglages** → carte
   composant → service : associer le composant de `PAY-2` au service connu, puis
   **enregistrer**. *Preuve ensuite :* `service-map=ok` et `issuesWithService`
   qui monte dans la capture ; sans association, `EXP-01` reste muet.
2. **R3 — accorder une dérogation.**
   Jira → ticket bloquant `PAY-19` → panneau contextuel de l'application →
   **Dérogation** → motif obligatoire → durée 24 h → **Accorder**. *Preuve
   ensuite :* la ligne « décisions et dérogations » de la capture affiche
   `dérogations=1`, et l'avis du dossier passe en « go sous conditions ».
3. **R4 — vérifier le masquage.**
   Ouvrir la page projet avec **un compte qui n'a pas les droits** sur un
   signal. *Preuve ensuite :* la couverture annonce « 1 élément restreint » au
   lieu d'afficher le signal ; le même chemin est couvert par les tests de
   `sanitizeDossierForViewer`.
4. **R7 — interroger l'agent Rovo.**
   Dans le chat Rovo du site : « Peut-on livrer la 2.4 ? » *Preuve ensuite :* la
   réponse cite les signaux du dossier (PAY-19, PAY-6, MOBL-58) et l'avis
   « no-go » — jamais de ticket que le dossier ne contienne.

Tant que ces quatre étapes ne sont pas jouées, le harnais les saute **avec la
raison exacte** : il ne masque rien, il dit pourquoi.

**Suite : le module « réglages » et la page projet.** Après la migration, le panneau du ticket
rend (capture ci-dessus), mais les modules `jira:projectSettingsPage` et `jira:projectPage`
restaient vides. La trace a été obtenue en journalisant, côté résolveur, ce que le module
avait reçu — le journal de production dit tout :

```
WARN ecran en erreur {
  key: 'screen.projectSettings',
  payload: [ 'projectId' ],
  extension: '{"project":{"key":"PAY","type":"software","id":"10234"},"type":"jira:projectSettingsPage", …}',
  message: 'Screen payload needs a "projectId" string.'
}
```

Le contexte du **résolveur** connaît le projet (`extension.project.id = 10234`) ; celui que la
**vue** reçoit ne le porte pas toujours. Le résolveur complète donc la charge utile
(`withProjectId`) et, quand un écran échoue, il journalise et répond un refus au lieu de
laisser le module vide — et les écrans affichent désormais l'erreur au lieu d'un squelette
infini.

### La cause réelle : le pont Forge rend `null` par `{}` (corrigé le 13/11)

L'erreur « Cannot read properties of undefined (reading 'COMP-01') » a disparu, mais les
deux modules restaient **vides**. La cause n'était plus dans la charge utile, mais dans la
**forme de la réponse**. Mesurée en interrogeant le pont depuis l'iframe du module :

| appel | réponse du résolveur | ce que la vue reçoit |
|---|---|---|
| `screen.projectSettings` (aucune policy enregistrée) | `null` | `{}` |
| `screen.impactGraph` (collection absente) | `null` | `{}` |
| `screen.projectPage` (version inconnue) | `null` | `{}` |
| `screen.projectVersions` | tableau | le tableau |

Un objet vide est **truthy**. L'écran des réglages faisait
`policy = draft ?? screen.data ?? emptyPolicy(...)` : il prenait donc `{}` pour une policy,
`severityOverrides` était `undefined`, et `SeverityRow` lisait `severityOverrides['COMP-01']`
→ **TypeError** → l'arbre React ne rendait rien → module vide. La console le disait mot
pour mot :

```
C-error: TypeError: Cannot read properties of undefined (reading 'COMP-01')
    at pe (…/main.js:2:2396)
C-error: TypeError: Cannot read properties of undefined (reading 'join')
    at ge (…/main.js:2:240544)
```

Second défaut, même famille : un écran en erreur répond le refus
`{ok:false, error:{code,message}}`, que la vue rendait comme une donnée.

**Le correctif** (`src/ui/response.ts`) : la lecture d'une réponse distingue *donnée*,
*vide* et *refus*, et `useScreen` l'applique — un seul endroit pour les quatre écrans.
`screen.projectSettings` répond en plus la **policy effective** du projet (celle
enregistrée, ou les valeurs par défaut), jamais `null` ; et `SettingsView` complète la
policy qu'on lui passe, pour qu'aucune vue ne plante sur les données qu'elle reçoit.

### Preuve du rendu (13/11/2026, production)

Vérifié dans un vrai navigateur (Chrome headless, profil dérivé, cookies de session
copiés en lecture seule — la session de l'utilisateur n'est jamais touchée), sur le site
de démo `one-atlas-cndz.atlassian.net`, projet `PAY` :

| module | avant | après (capture) |
|---|---|---|
| `jira:projectSettingsPage` | module vide (0 champ de formulaire) | **39 champs**, table des gravités, bouton « Save » |
| `jira:projectPage` | module vide | verdict **NO-GO**, couverture, onglets, « Simulate without » |

Captures : `2026-11-13-reglages-rendu-apres-correctif.png` et
`2026-11-13-page-projet-rendu-apres-correctif.png` (`docs/preuves/captures/`).

Le test de rendu d'une policy partielle **échoue sans le correctif** et passe avec
(`tests/ui/screens.test.tsx`) : le bug de production est verrouillé par un test.


## Rejouer la preuve

```bash
python3 scripts/preuves/capture.py                  # ~40 s : lecture seule + un PUT idempotent
python3 scripts/preuves/capture.py --lecture-seule  # ~20 s : aucun événement
python3 scripts/preuves/capture.py --avec-recette   # + harnais §17 complet (~4 min)
```

Le script déclenche le recalcul par le vrai événement Jira (`PUT
/rest/api/3/version/{id}`, idempotent — même nom de version, aucune donnée
changée, cf. [docs/OPS.md](OPS.md) §6) : c'est ainsi que les journaux de
production contiennent la chaîne à prouver. Aucun secret n'est écrit dans les
preuves, et le jeton Atlassian n'est jamais lu par ce script.

## Les écrans ne se rendaient pas — preuve, cause, correction (2026-11-12)

**Ce que le navigateur a débusqué, et que rien d'autre ne voyait.** Le harnais ne teste que
l'API et le moteur ; les tests de rendu utilisent `react-dom/server`, qui accepte n'importe
quel HTML. Aucun contrôle automatique n'ouvrait donc les écrans. Le premier contrôle dans un
vrai navigateur a trouvé, sur les quatre écrans de production :

```
Error rendering app - encountered unknown component p.
```

**La cause.** En UI Kit 2, le document rendu ne contient que des composants que la plateforme
dessine (`Box`, `Text`, `Heading`, `Button`…). Un élément HTML brut (`<div>`, `<p>`, `<span>`)
est rejeté par le moteur de rendu d'Atlassian. Les écrans en contenaient **107**.

**La correction.** `src/ui/kit.tsx` est une façade sur `@forge/react` — le même motif que
`laddition/src/ui/kit.tsx` sur ce site de démonstration. Les 19 fichiers d'écran n'importent
plus que cette façade, et les paquets Atlaskit utilisés sont déclarés en dépendances : ils
n'étaient que transitifs, donc inlinés dans le bundle au lieu d'être fournis par la plateforme.
Le graphe d'impact, qui était un `<svg>` inline, part désormais en image (data-URI) et garde
sa liste équivalente (SPEC §11).

**Les captures sont dans `docs/preuves/captures/`** :

| capture | ce qu'elle montre |
| --- | --- |
| `2026-11-12-panneau-ticket-RAYON-IMPACT.png` | le panneau « Rayon d'impact » du ticket PAY-19, déplié : *This ticket holds back 2.4: COMP-01 — Ticket PAY-19 is still In Progress (in-progress).* |
| `2026-11-12-reglages-attente-resolveur.png` | l'écran de réglages sur le squelette de chargement — l'état d'alors, avant le correctif du 13/11 (la cause n'était pas celle que l'on croyait : voir « La cause réelle » plus haut). |
| `2026-11-13-reglages-rendu-apres-correctif.png` | **l'écran de réglages rendu** : « Release impact settings », la table des gravités (COMP-01, COMP-02, COMP-03…), les sélecteurs et cases à cocher. 39 champs de formulaire là où le module était vide. |
| `2026-11-13-page-projet-rendu-apres-correctif.png` | **la page projet rendue** : verdict NO-GO, couverture, « No change since the last dossier », onglets et bouton « Simulate without ». |

**Recette navigateur reproductible** (fenêtre sans focus, sans toucher à la session de
l'utilisateur) : copier le profil Chrome de la machine, en extraire les cookies de session **en
lecture seule** via CDP, puis piloter un navigateur isolé sur l'affichage virtuel `:99` (Xvfb).
Aucun secret n'est écrit dans le dépôt.
