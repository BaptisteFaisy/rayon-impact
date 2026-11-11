# Rayon d'impact d'une release — cahier des charges

> Codegeist 2026 · catégorie **Apps for Software Teams**
> Bonus visés : Teamwork Graph, Agents Rovo, MCP, Marketplace
> Version 1 du 11 novembre 2026 · soumission avant le mardi 22 décembre 2026, 21 h (Paris)

## 1. L'idée en une phrase

Avant de publier une version Jira, l'app parcourt tout ce qui s'y rattache (tickets, code, builds, services, équipes, incidents, documentation) et rend un avis **go / go sous conditions / no-go**, où chaque raison pointe vers sa preuve.

## 2. Le problème

La décision de livrer se prend aujourd'hui en réunion, à partir de ce que chacun a en tête. L'information existe, mais elle est dispersée :

- Jira sait quels tickets sont dans la version et lesquels sont bloqués.
- L'outil de code sait quelles PR sont encore ouvertes et quels builds sont rouges.
- JSM sait qu'un incident est en cours sur un des services touchés.
- Compass sait quelles équipes dépendent de ces services.
- Confluence contient la doc que personne n'a mise à jour.

Personne ne fait la jointure. Les conséquences sont connues : une équipe voisine découvre le changement en production, on livre par-dessus un incident ouvert, le support apprend la nouveauté par un client.

Le thème de Codegeist 2026 (« Build with context. Ship with confidence. ») décrit exactement ce manque : la confiance au moment de livrer vient du contexte, pas d'un tableau de tickets verts.

## 3. Utilisateurs et moments d'usage

| Qui | Moment | Ce qu'il veut savoir |
|---|---|---|
| Responsable de release, tech lead | La veille et le matin de la livraison | Peut-on y aller, et sinon que faut-il lever ? |
| Développeur | En ouvrant son ticket | Mon ticket retient-il la release ? |
| Astreinte, SRE | Avant sa garde | Qu'est-ce qui arrive en production, sur quels services ? |
| Lead d'une équipe dépendante | Dès que la version le concerne | Suis-je touché, et par quoi ? |
| Support, rédaction technique | Avant l'annonce | Quelles pages sont à mettre à jour ? |
| Direction technique | Après coup | Qui a décidé, sur quelle base, et que s'est-il passé ensuite ? |

## 4. Vocabulaire du produit

- **Dossier de release** : l'évaluation d'une version Jira à un instant donné. Il contient les signaux, l'avis, la couverture des données et un texte de synthèse.
- **Signal** : un fait vérifiable qui pèse sur la décision (« PAY-131 est encore en cours »). Il a un code, une gravité, un sujet, une preuve cliquable et une façon de le lever.
- **Avis** : go, go sous conditions ou no-go. C'est une recommandation ; la décision reste humaine.
- **Dérogation** : l'acceptation explicite d'un signal par une personne habilitée, avec motif et date d'expiration.
- **Décision** : ce que l'équipe a réellement fait, tracé avec l'avis du moment.
- **Bilan** : ce qui s'est passé dans les 72 heures qui suivent la publication.
- **Couverture** : la part des tickets pour lesquels l'app voit réellement le code et les services. Sans donnée, l'app le dit au lieu de conclure que tout va bien.

## 5. Périmètre

Priorités utilisées dans ce document : **M** = indispensable pour la soumission, **S** = souhaitable si le temps le permet, **C** = après le hackathon.

| Lot | Contenu |
|---|---|
| MVP (22 décembre) | Dossier de release sur une version, 9 signaux, avis et synthèse rédigée, page projet, encart sur le ticket, dérogations, journal des décisions, agent Rovo et outils MCP en lecture |
| V1 | Bilan à 72 h, gadget de tableau de bord, simulation « et si on retire ce ticket », différences depuis la veille, export Confluence, gel de déploiement |
| Vision | Poids des signaux appris des bilans, trains de release multi-projets, préavis automatiques aux équipes touchées |

Hors périmètre : déclencher ou bloquer techniquement un déploiement. L'app éclaire la décision, elle ne pilote pas la chaîne de livraison.

## 6. Parcours détaillés

### 6.1 Le matin de la livraison

1. Le responsable ouvre **Projet → Rayon d'impact** et choisit la version 2.4.
2. L'écran affiche **NO-GO**, confiance haute, et trois raisons classées par gravité.
3. Il déplie la première : « Incident INC-52 ouvert sur checkout-api, service touché par PAY-127 et PAY-131 ». Un clic ouvre l'incident.
4. Il déplie la deuxième : « PAY-131 a une PR encore ouverte ». Le bouton **Simuler sans ce ticket** recalcule l'avis : go sous conditions.
5. Il retire PAY-131 de la version dans Jira. L'app recalcule seule.
6. Pour le troisième signal (« Guide d'intégration non mis à jour »), il accorde une dérogation de 48 h avec un motif. La rédactrice technique reçoit un ticket.
7. L'avis passe à **GO sous conditions** ; les conditions sont listées. Il clique **Enregistrer la décision : on livre**.

### 6.2 Le développeur

Sur son ticket, un encart indique : « Ce ticket retient la version 2.4 : build rouge sur le dernier commit ». Aucun autre écran à ouvrir.

### 6.3 L'équipe voisine

Le lead Mobile ouvre Rovo Chat : « Est-ce que la 2.4 de Paiements nous touche ? ». L'agent répond avec le service concerné, le ticket Mobile qui en dépend et la date prévue.

### 6.4 Après la livraison

72 heures après la publication, l'app relit les incidents créés sur les services touchés et complète le dossier : « 1 incident mineur, résolu en 40 minutes ». Ce bilan alimente le signal « zone à risque » des versions suivantes.

## 7. Catalogue des signaux

| Code | Signal | Source | Gravité par défaut | Lot |
|---|---|---|---|---|
| COMP-01 | Ticket de la version non terminé | Jira, recherche sur `fixVersion` | Bloquant | M |
| COMP-02 | Ticket terminé sans aucun commit ni PR | Teamwork Graph ou JQL `development[...]` | Majeur | M |
| COMP-03 | PR encore ouverte sur un ticket de la version | idem | Bloquant | M |
| COMP-04 | Ticket ajouté à la version depuis moins de 48 h | Historique du ticket | Mineur | S |
| QUAL-01 | Dernier build en échec sur un ticket de la version | Teamwork Graph ou JQL `development[...]` | Bloquant | M |
| QUAL-02 | PR fusionnée sans approbation | Teamwork Graph (relecteurs) | Majeur | S |
| QUAL-03 | Bug rouvert pendant le cycle | Historique du ticket | Mineur | S |
| DEP-01 | Ticket bloqué par un ticket encore ouvert | Liens Jira | Bloquant | M |
| DEP-02 | Ticket d'un autre projet qui dépend de cette version | Liens Jira inter-projets | Majeur | M |
| DEP-03 | Service dépendant dont l'équipe n'a aucun ticket lié | Compass, Teamwork Graph | Mineur | S |
| EXP-01 | Incident ouvert sur un service touché | JSM | Bloquant | M |
| EXP-02 | Incident résolu depuis moins de 7 jours sur un service touché | JSM | Majeur | M |
| EXP-03 | Gel de déploiement à la date prévue | Calendrier tenu dans l'app | Bloquant | S |
| EXP-04 | Autre version prévue le même jour sur les mêmes services | Versions Jira | Majeur | S |
| DOC-01 | Page Confluence liée, non modifiée depuis le début du cycle | Liens distants Jira, Confluence | Mineur | M |
| HIST-01 | Zone à risque : versions précédentes sur ce composant suivies d'incidents | Bilans passés | Majeur | C |
| OBJ-01 | La version porte un objectif dont l'échéance approche | Teamwork Graph | Information | C |

Chaque signal affiche quatre choses : ce qui est constaté, pourquoi cela compte, le lien vers la preuve, et comment le lever.

### Rattacher un ticket à un service

Tout le volet exploitation dépend de ce rattachement. Trois sources, dans cet ordre :

1. La relation « Jira work item impacts Compass component » du Teamwork Graph.
2. Le champ « services affectés » ou le composant Jira du ticket.
3. Une table de correspondance tenue dans les réglages de l'app (composant Jira → service).

Un ticket sans service connu n'est pas ignoré : il fait baisser la couverture.

## 8. Calcul de l'avis

Les règles sont déterministes. Le modèle de langage n'intervient que pour rédiger la synthèse.

- **NO-GO** : au moins un signal bloquant actif, sans dérogation.
- **GO sous conditions** : aucun bloquant actif, mais au moins un signal majeur actif ou une dérogation en cours. Les conditions sont énumérées.
- **GO** : ni bloquant ni majeur actif.

**Confiance.** Elle dépend de la couverture :

- Haute : code visible pour au moins 90 % des tickets et service connu pour au moins 80 %.
- Moyenne : entre les deux.
- Basse : code visible pour moins de 70 % des tickets. L'avis le formule alors ainsi : « Je ne vois aucun commit pour 6 tickets sur 14 : soit le dépôt n'est pas relié à Jira, soit rien n'a été codé. »

**Synthèse rédigée.** Le modèle reçoit uniquement la liste structurée des signaux et produit 5 à 8 lignes. Chaque phrase doit citer un code de signal ; une vérification automatique rejette tout texte qui mentionne un ticket ou un service absent des signaux.

**Simulation.** Pour chaque ticket porteur d'un signal bloquant, l'app sait recalculer l'avis sans lui. Elle propose le plus petit ensemble de tickets à retirer pour quitter le no-go.

## 9. Exigences fonctionnelles

| N° | Exigence | Priorité |
|---|---|---|
| RI-01 | Lister les versions non publiées d'un projet avec leur avis courant | M |
| RI-02 | Calculer un dossier complet pour une version de 200 tickets en moins de 60 s, en arrière-plan | M |
| RI-03 | Recalculer automatiquement quand un ticket, un lien ou la version change | M |
| RI-04 | Afficher chaque signal avec preuve cliquable et moyen de le lever | M |
| RI-05 | Afficher la couverture des données et la confiance de l'avis | M |
| RI-06 | Produire la synthèse rédigée, vérifiée contre les signaux | M |
| RI-07 | Accorder, lister et faire expirer des dérogations (motif obligatoire) | M |
| RI-08 | Enregistrer la décision humaine avec l'avis du moment | M |
| RI-09 | Afficher sur chaque ticket s'il retient une version, et pourquoi | M |
| RI-10 | Ne jamais révéler un ticket ou un incident que le lecteur n'a pas le droit de voir | M |
| RI-11 | Régler la gravité de chaque signal par projet | M |
| RI-12 | Vue en graphe : version, tickets, code, services, équipes, incidents | S |
| RI-13 | Simulation « sans ce ticket » et plus petit ensemble à retirer | S |
| RI-14 | Différences depuis le dossier précédent (« depuis hier ») | S |
| RI-15 | Bilan à 72 h après publication | S |
| RI-16 | Gadget de tableau de bord : versions à venir et leur avis | S |
| RI-17 | Export du dossier dans une page Confluence | C |
| RI-18 | Préavis automatique aux équipes touchées (commentaire sur leur ticket lié) | C |
| RI-19 | Calendrier des gels de déploiement | S |

## 10. Agent Rovo et outils MCP

### Agent « Rayon d'impact »

Module `rovo:agent` (nom limité à 30 caractères). Amorces de conversation proposées :

- « Peut-on livrer la 2.4 ? »
- « Qu'est-ce qui retient la prochaine version ? »
- « Quelles équipes sont touchées par la 2.4 ? »
- « Que s'est-il passé après la 2.3 ? »

L'agent ne calcule rien lui-même : il appelle les actions ci-dessous et restitue leurs résultats avec les liens.

### Actions, aussi exposées par `rovo:mcp`

| Clé d'action | Verbe | Entrées | Retour |
|---|---|---|---|
| `get-release-impact` | GET | `projectKey`, `versionName` | Avis, confiance, synthèse, compte des signaux |
| `list-release-signals` | GET | `versionId`, `severity` (optionnel) | Signaux détaillés avec preuves |
| `explain-signal` | GET | `signalId` | Constat, raison, levée possible |
| `list-impacted-teams` | GET | `versionId` | Équipes, services, tickets liés |
| `simulate-without` | GET | `versionId`, `issueKeys` | Avis recalculé |
| `get-release-outcome` | GET | `versionId` | Décision prise et bilan |
| `request-waiver` | CREATE | `signalId`, `reason`, `hours` | Dérogation créée ou refus motivé |

Les entrées d'action n'acceptent que des chaînes, entiers, nombres et booléens ; les listes passent donc en chaîne séparée par des virgules.

Les outils en lecture servent aussi à un agent de code externe : avant de fusionner, il peut demander si son ticket retient une version.

## 11. Écrans

1. **Page projet « Rayon d'impact »** (`jira:projectPage`). En-tête : version, date prévue, avis, confiance, date du calcul. Corps : signaux groupés par gravité, puis onglets Graphe, Équipes touchées, Dérogations, Historique.
2. **Encart sur le ticket** (`jira:issueContext`). Une ligne : la version concernée et ce qui la retient à cause de ce ticket, ou « rien ne retient la version ».
3. **Réglages du projet** (`jira:projectSettingsPage`). Gravité par signal, correspondance composant → service, projets JSM à surveiller, qui peut déroger.
4. **Gadget** (`jira:dashboardGadget`). Les versions des 14 prochains jours avec leur avis.

Jira n'offre aucun module Forge qui s'affiche dans la page native des versions ; la page projet de l'app en tient lieu.

La vue en graphe a toujours un équivalent en liste, pour l'accessibilité et pour les versions de plus de 150 nœuds.

## 12. Architecture Forge

Une seule app, installée sur Jira (requis) et Confluence (optionnel).

```yaml
# Esquisse, à valider avec forge lint
app:
  compatibility:
    jira:
      required: true
    confluence:
      required: false
modules:
  jira:projectPage:          # écran principal
  jira:issueContext:         # encart sur le ticket
  jira:projectSettingsPage:  # réglages
  jira:dashboardGadget:      # lot S
  trigger:                   # avi:jira:{created,updated,released,unreleased}:version
                             # avi:jira:updated:issue, avi:jira:{created,deleted}:issuelink
  scheduledTrigger:          # rafraîchissement horaire, bilan à 72 h
  consumer:                  # recalcul en arrière-plan, timeoutSeconds: 900
  sql:                       # dossiers, signaux, dérogations, décisions
  llm:                       # synthèse rédigée
  rovo:agent:
  action:                    # 7 actions
  rovo:mcp:                  # mêmes actions, exposées comme outils
```

### Flux de calcul

1. Un événement Jira arrive. L'app marque la version « à recalculer » et poste un message dans la file, au plus une fois par minute et par version.
2. Le consommateur collecte en parallèle : tickets de la version, liens, historique, incidents JSM, pages liées.
3. Le moteur de signaux applique les règles et la politique du projet.
4. L'avis est calculé, la synthèse rédigée puis vérifiée.
5. Le dossier est enregistré. Les écrans lisent toujours le dernier dossier enregistré, jamais en direct.

### Lecture du Teamwork Graph

L'API ne s'appelle qu'au nom d'un utilisateur (`api.asUser().requestTeamworkGraph`). La collecte « graphe » (code, relecteurs, composants Compass, équipes) se fait donc quand un utilisateur ouvre la page ou interroge l'agent, puis elle est mise en cache dans le dossier avec sa date.

Le recalcul en arrière-plan s'appuie sur l'API REST de Jira au nom de l'app, avec en secours la recherche JQL sur l'information de développement (par exemple `development[pullrequests].open > 0`).

## 13. Modèle de données (Forge SQL)

| Table | Colonnes principales |
|---|---|
| `release_snapshot` | id, project_id, version_id, computed_at, verdict, confidence, coverage_json, narrative |
| `signal` | id, snapshot_id, code, severity, status (actif, dérogé, levé), subject_type, subject_id, evidence_json, first_seen_at |
| `waiver` | id, version_id, signal_code, subject_id, granted_by, reason, expires_at |
| `decision` | id, version_id, decided_by, decided_at, decision, verdict_at_decision, note |
| `outcome` | version_id, checked_at, incidents_72h, rollback, notes |
| `policy` | project_id, rules_json |
| `service_map` | project_id, jira_component, compass_component_id, jsm_service |

Forge SQL n'a pas de clés étrangères : l'intégrité est tenue dans le code.

## 14. Contraintes vérifiées et points à valider

### Vérifié dans la documentation (10 et 11 novembre 2026)

- Événements de version disponibles : `avi:jira:created|updated|released|unreleased|archived|deleted:version`.
- Fonctions asynchrones et planifiées : jusqu'à 900 s. Actions Rovo et web triggers : 55 s. Charge utile : 5 Mo.
- Forge SQL : 1 Gio par installation en production, 200 tables, 5 s par SELECT.
- Forge LLMs : modèles Claude uniquement, texte seul, 100 requêtes par minute et 500 000 jetons par minute et par modèle, par installation.
- API Teamwork Graph : en Preview. Requêtes Cypher enregistrées ou requêtes « curated » uniquement, le Cypher libre étant fermé aux nouvelles apps. Un scope `read:graph:…` par type d'objet, accordé par un administrateur d'organisation. Un scope manquant ne produit pas d'erreur : les objets sont omis en silence.
- Une app appelle l'API Teamwork Graph **ou** fournit un connecteur, pas les deux.
- Relations utiles présentes dans le graphe : ticket → commit, branche, build externes ; PR → commit ; ticket → composant Compass ; équipe → composant Compass ; incident JSM → service.
- La compatibilité multi-apps couvre Jira et Confluence. Une app qui l'utilise ne peut être listée sur le Marketplace qu'en payant.
- `rovo:mcp` : en Preview, un module par app, 50 outils au plus. L'accès par un client MCP externe est désactivé par défaut et s'active par installation dans l'administration Atlassian.

### À valider par un prototype la première semaine

| Point | Pourquoi c'est important | Solution de repli |
|---|---|---|
| Le site de démonstration fourni contient-il de l'information de développement (commits, PR, builds) ? | Sans elle, la moitié des signaux sont muets | Relier un dépôt d'essai ; données d'exemple injectées par l'app |
| Noms exacts des scopes et des relations du graphe | Nécessaires aux requêtes enregistrées | Query Builder du site ; JQL `development[...]` |
| Appel du graphe hors session utilisateur | Permettrait un recalcul complet en arrière-plan | Collecte à l'ouverture de la page, avec cache |
| Syntaxe JQL `development[...]` au nom de l'app | Source de secours pour le code | Champ « Développement » du ticket |
| Compass accessible depuis une app Jira | Deux pages de doc se contredisent | Table de correspondance dans les réglages |
| Relation directe ticket ↔ PR dans le graphe | La doc ne montre que ticket → commit et PR → commit | Passer par les commits |

## 15. Exigences non fonctionnelles

- **Rapidité.** Ouverture de la page en moins de 2 s, puisque l'écran lit un dossier enregistré. Recalcul d'une version de 200 tickets en moins de 60 s.
- **Droits.** Le dossier est calculé au nom de l'app, mais chaque preuve est filtrée à l'affichage selon les droits du lecteur. Un élément non visible apparaît comme « 1 élément masqué (accès restreint) » et compte quand même dans l'avis.
- **Données.** Aucune sortie réseau hors Atlassian : stockage Forge SQL, modèle hébergé par Atlassian. C'est un argument de confiance à mettre en avant.
- **Traçabilité.** Dérogations et décisions ne sont jamais supprimées, seulement closes.
- **Honnêteté.** L'absence de donnée n'est jamais présentée comme une bonne nouvelle.
- **Langues.** Interface en anglais et en français. La soumission (vidéo, description, instructions) doit être en anglais.
- **Volume.** Jusqu'à 1 000 tickets par version ; au-delà, l'app prévient qu'elle échantillonne les signaux mineurs.

## 16. Cas limites

- Version vide ou sans date : avis « sans objet », pas de go par défaut.
- Ticket présent dans deux versions : il compte dans les deux dossiers.
- Projet géré par l'équipe sans la fonction Versions : l'app l'explique dans l'écran.
- Aucun dépôt relié à Jira : confiance basse, signaux de code désactivés et annoncés comme tels.
- Incident sans service renseigné : rattaché par composant, sinon ignoré avec mention dans la couverture.
- Version renommée ou tickets déplacés en masse : recalcul regroupé, un seul par minute.
- Version publiée puis dépubliée : le dossier figé est conservé, un nouveau cycle commence.
- Dérogation expirée pendant la nuit : l'avis repasse en no-go au prochain recalcul horaire.

## 17. Recette

1. Étant donné une version dont un ticket est « En cours », quand le dossier est calculé, alors l'avis est no-go et COMP-01 cite ce ticket.
2. Étant donné un incident ouvert sur un service rattaché à un ticket de la version, alors EXP-01 apparaît avec un lien vers l'incident.
3. Étant donné un signal bloquant, quand une personne habilitée accorde une dérogation de 24 h, alors l'avis devient go sous conditions et la dérogation figure dans la liste.
4. Étant donné un lecteur sans accès au projet JSM, alors la preuve de EXP-01 est remplacée par « 1 élément masqué » et l'avis ne change pas.
5. Étant donné un projet sans dépôt relié, alors la confiance est basse et le texte l'explique.
6. Quand un ticket bloquant passe à « Terminé », alors le dossier est recalculé en moins de 2 minutes sans action manuelle.
7. Quand on demande à l'agent « Peut-on livrer la 2.4 ? », alors sa réponse donne le même avis et les mêmes raisons que l'écran.
8. La synthèse rédigée ne cite aucun ticket absent des signaux (vérifié sur 20 dossiers d'essai).

## 18. Scénario de la vidéo (moins de 5 minutes, en anglais)

| Temps | Contenu |
|---|---|
| 0:00 – 0:30 | Le problème : une réunion go/no-go où chacun regarde un outil différent |
| 0:30 – 1:30 | Version 2.4 du projet Paiements : no-go, trois raisons, preuves ouvertes une à une |
| 1:30 – 2:15 | Vue en graphe : la version au centre, l'équipe Mobile en périphérie |
| 2:15 – 3:00 | Simulation sans PAY-131, dérogation sur la doc, avis qui passe à go sous conditions |
| 3:00 – 3:40 | Agent Rovo interrogé par le lead Mobile ; le même outil appelé depuis un client MCP |
| 3:40 – 4:20 | Publication, puis bilan à 72 h |
| 4:20 – 4:45 | Architecture en un schéma : Forge, Teamwork Graph, Rovo, MCP |

Jeu de données à préparer : projet Paiements, version 2.4 de 14 tickets dont un en cours, un avec PR ouverte, deux touchant `checkout-api`, un incident ouvert, un ticket Mobile lié, une page « Guide d'intégration » ancienne.

## 19. Plan jusqu'au 22 décembre

| Semaine | Objectif |
|---|---|
| 11 – 17 nov. | Site de démo, squelette de l'app, les six validations du § 14, jeu de données |
| 18 – 24 nov. | Collecte Jira, signaux COMP et DEP, stockage, calcul de l'avis |
| 25 nov. – 1er déc. | Signaux EXP et DOC, lecture du graphe, page projet |
| 2 – 8 déc. | Dérogations, décisions, encart ticket, synthèse rédigée |
| 9 – 15 déc. | Agent, actions, MCP, simulation ; gel des fonctionnalités le 15 |
| 16 – 22 déc. | Recette, vidéo, instructions pour les juges, soumission, dépôt Marketplace |

## 20. Risques

| Risque | Parade |
|---|---|
| Scopes du graphe non accordés sur le site des juges | L'app fonctionne sans le graphe (JQL), avec une confiance réduite et annoncée |
| Peu de données de développement sur le site de démo | Bouton « charger un jeu d'exemple » documenté dans les instructions |
| Avis jugé trop sévère, donc ignoré | Gravités réglables, dérogations, mode observation sans avis affiché sur les tickets |
| Synthèse inexacte | Règles déterministes pour l'avis ; texte vérifié contre les signaux |
| Trop de signaux pour six semaines | Neuf signaux M seulement ; le reste est classé S ou C |

## 21. Ce qui prouvera la valeur

- Temps pour réunir les éléments d'un go/no-go : de 30 minutes de réunion à une lecture de 2 minutes.
- Part des versions suivies d'un incident dans les 72 h, avant et après adoption.
- Nombre de signaux bloquants découverts avant la livraison plutôt qu'après.

## 22. La vision poussée à l'extrême

- **L'app apprend de ses bilans.** Si le signal « incident récent sur le service » précède régulièrement un incident après livraison, son poids monte ; un signal jamais suivi d'effet descend. Chaque organisation obtient sa propre politique, justifiée par son historique.
- **Trains de release.** Plusieurs projets livrent ensemble ; le dossier s'étend à toutes leurs versions et détecte les collisions entre elles.
- **Préavis automatiques.** Chaque équipe touchée reçoit, sur son propre ticket, ce qui change pour elle et quand.
- **Mémoire des décisions.** « La dernière fois qu'on a livré avec cette dérogation, voici ce qui s'est passé. »
- **Porte d'entrée unique pour les agents.** Un agent de code qui prépare une PR, un agent d'astreinte qui prend sa garde et un agent support qui rédige l'annonce interrogent tous le même dossier par MCP.

## 23. Sources

- [Codegeist 2026](https://codegeist2026.devpost.com/) et son [règlement](https://codegeist2026.devpost.com/rules)
- [Événements Jira dans Forge](https://developer.atlassian.com/platform/forge/events-reference/jira/)
- [Modules Jira](https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-jira/)
- [Appeler l'API Teamwork Graph](https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/)
- [Types de relations du graphe](https://developer.atlassian.com/platform/teamwork-graph/api-reference/relationship-types/overview/)
- [Limites d'invocation](https://developer.atlassian.com/platform/forge/limits-invocation/), [limites SQL](https://developer.atlassian.com/platform/forge/limits-sql/), [limites LLM](https://developer.atlassian.com/platform/forge/limits-llm/)
- [Module Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/), [module Rovo Agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/), [module Action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)
- [Compatibilité multi-apps](https://developer.atlassian.com/platform/forge/app-compatibility/)
