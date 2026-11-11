import type { Locale, MessageRef } from '../types';

/**
 * Pure i18n dictionary for English and French (SPEC §15).
 *
 * Avoids raw string literals across the app so every UI element, notification,
 * Rovo explanation and MCP response can be localized with zero external library.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
export const DICTIONARY_EN: Record<string, string> = {
  // Verdicts
  'verdict.go': 'GO',
  'verdict.conditional-go': 'CONDITIONAL GO',
  'verdict.no-go': 'NO-GO',
  'verdict.not-applicable': 'NOT APPLICABLE',

  // Confidence
  'confidence.high': 'High confidence',
  'confidence.medium': 'Medium confidence',
  'confidence.low': 'Low confidence',
  'confidence.low.detail':
    'I see no commits for {missing} of {total} tickets: either the repository is not linked to Jira, or nothing was coded.',

  // Severity
  'severity.blocking': 'Blocking',
  'severity.major': 'Major',
  'severity.minor': 'Minor',
  'severity.info': 'Info',

  // Signal sources
  'signal.source.jira': 'Jira (fixVersion)',
  'signal.source.dev': 'Teamwork Graph or JQL development[...]',
  'signal.source.graph': 'Teamwork Graph',
  'signal.source.jiraHistory': 'Jira issue history',
  'signal.source.jiraLinks': 'Jira issue links',
  'signal.source.compass': 'Compass component mapping',
  'signal.source.jsm': 'Jira Service Management incidents',
  'signal.source.freeze': 'Release calendar (freeze windows)',
  'signal.source.jiraVersions': 'Jira project versions',
  'signal.source.confluence': 'Linked Confluence pages',
  'signal.source.pastOutcomes': 'Past release 72h outcomes',

  // Signal catalogue EN: COMP-01
  'signal.comp01.title': 'Unfinished ticket in release',
  'signal.comp01.why': 'Shipping a release that still has in-flight work leaves features half-done in production.',
  'signal.comp01.clear': 'Move the ticket to Done, or remove it from this release.',
  'signal.comp01.finding': 'Ticket {key} is still {status} ({category}).',

  // COMP-02
  'signal.comp02.title': 'Done ticket with no commit or PR',
  'signal.comp02.why': 'A ticket marked done without code may be an administrative task, or unlinked work.',
  'signal.comp02.clear': 'Link the commits or PR to {key}, or attach a note.',
  'signal.comp02.finding': 'Ticket {key} is marked Done but has 0 commits and 0 pull requests.',

  // COMP-03
  'signal.comp03.title': 'Open PR on release ticket',
  'signal.comp03.why': 'Unmerged pull requests mean the code running in production will not match the ticket.',
  'signal.comp03.clear': 'Merge or close the open PRs on {key}, or drop the ticket from the release.',
  'signal.comp03.finding': 'Ticket {key} has {count} open pull request(s).',

  // COMP-04
  'signal.comp04.title': 'Ticket added to release less than 48h ago',
  'signal.comp04.why': 'Late additions to a release are the primary vector for regressions and rushed testing.',
  'signal.comp04.clear': 'Verify test coverage for {key}, or request a waiver with a reason.',
  'signal.comp04.finding': 'Ticket {key} joined the release {hours}h ago (under 48h).',

  // QUAL-01
  'signal.qual01.title': 'Latest build failed on release ticket',
  'signal.qual01.why': 'A failing build on a ticket means the latest artifacts did not pass continuous integration.',
  'signal.qual01.clear': 'Fix the build on {key} and get CI green, or revert the commit.',
  'signal.qual01.finding': 'Latest build on ticket {key} failed ({count} failing build(s) recorded).',

  // QUAL-02
  'signal.qual02.title': 'PR merged without approval',
  'signal.qual02.why': 'Peer reviews catch critical defects; shipping unreviewed code raises the incident risk.',
  'signal.qual02.clear': 'Run a retroactive review on {key}, or request a waiver.',
  'signal.qual02.finding': 'Ticket {key} contains {count} PR(s) merged without required approvals.',

  // QUAL-03
  'signal.qual03.title': 'Bug reopened during the cycle',
  'signal.qual03.why': 'A reopened bug indicates instability in the fix, which frequently breaks again in production.',
  'signal.qual03.clear': 'Ensure an explicit non-regression test was added for {key}.',
  'signal.qual03.finding': 'Bug {key} was reopened at least once during this release cycle.',

  // DEP-01
  'signal.dep01.title': 'Ticket blocked by an open issue',
  'signal.dep01.why': 'If a dependency is open, this feature cannot function as designed in production.',
  'signal.dep01.clear': 'Resolve blocker {blockerKey}, or remove {key} from the release.',
  'signal.dep01.finding': 'Ticket {key} is blocked by {blockerKey}, which is still {blockerStatus}.',

  // DEP-02
  'signal.dep02.title': 'Cross-project dependency on this release',
  'signal.dep02.why': 'Another team relies on this version; they need advance notice before the cut.',
  'signal.dep02.clear': 'Notify the team of {targetKey} that this release is about to ship.',
  'signal.dep02.finding': 'Ticket {targetKey} ({projectKey}) depends on ticket {key} in this release.',

  // DEP-03
  'signal.dep03.title': 'Impacted dependent service has no linked ticket',
  'signal.dep03.why': 'Service {service} depends on this release but its owning team has no work item tracked.',
  'signal.dep03.clear': 'Reach out to the service owner, or link a ticket.',
  'signal.dep03.finding': 'Service {service} is affected by the release but owning team has 0 linked tickets.',

  // EXP-01
  'signal.exp01.title': 'Open incident on impacted service',
  'signal.exp01.why': 'Deploying while an incident is in progress complicates triage and risks making the outage worse.',
  'signal.exp01.clear': 'Wait for incident {incidentKey} to be resolved, or decouple the release from {service}.',
  'signal.exp01.finding': 'Open incident {incidentKey} on service {service} (impacted by {issues}).',

  // EXP-02
  'signal.exp02.title': 'Recent incident on impacted service (<7 days)',
  'signal.exp02.why': 'Services recovering from a recent outage have reduced resilience and higher rollback odds.',
  'signal.exp02.clear': 'Verify the post-incident fixes are stable on {service}, or request a waiver.',
  'signal.exp02.finding': 'Incident {incidentKey} was resolved {days}d ago on service {service} (under 7 days).',

  // EXP-03
  'signal.exp03.title': 'Deployment freeze window active',
  'signal.exp03.why': 'Production is frozen (e.g. holiday peak, financial close); deployments are blocked.',
  'signal.exp03.clear': 'Reschedule the release outside [{from} - {to}], or get VP-level approval.',
  'signal.exp03.finding': 'Release date {date} falls into freeze window "{freezeName}" ({from} - {to}).',

  // EXP-04
  'signal.exp04.title': 'Multiple releases scheduled on same service today',
  'signal.exp04.why': 'Concurrent releases on the same service create race conditions and confuse incident triage.',
  'signal.exp04.clear': 'Coordinate rollout order with version {siblingVersion}.',
  'signal.exp04.finding': 'Version {siblingVersion} also ships on {date} and touches service {service}.',

  // DOC-01
  'signal.doc01.title': 'Linked Confluence page not updated this cycle',
  'signal.doc01.why': 'Stale documentation leads to customer confusion and support escalations after launch.',
  'signal.doc01.clear': 'Review and touch the linked page "{pageTitle}", or grant a waiver.',
  'signal.doc01.finding': 'Page "{pageTitle}" has not been modified since {cycleStart} (release cycle start).',

  // HIST-01
  'signal.hist01.title': 'High-risk zone: past releases on this component had incidents',
  'signal.hist01.why': 'Historical 72h outcomes on this component show an elevated rate of post-release incidents.',
  'signal.hist01.clear': 'Ensure extra smoke testing and an on-call engineer during rollout.',
  'signal.hist01.finding': 'Past releases touching {service} had {count} incident(s) in their 72h window.',

  // OBJ-01
  'signal.obj01.title': 'Release carries an approaching objective milestone',
  'signal.obj01.why': 'Helps the team understand business urgency without affecting the technical go/no-go.',
  'signal.obj01.clear': 'Informational signal: no action required.',
  'signal.obj01.finding': 'Milestone "{milestone}" is due on {due}.',

  // Privacy & UI
  'evidence.restricted': '1 hidden item (restricted access)',
  'evidence.view': 'View proof',
  'simulation.bestSet': 'Removing {count} ticket(s) ({keys}) lifts the NO-GO verdict.',
  // Simulation (RI-13) et differences (RI-14) - ajoutees le 11/11/2026
  'simulation.run': 'Simulate without {keys}',
  'simulation.runMinimal': 'Remove {count} ticket(s) to lift the no-go',
  'simulation.dropped': '{count} signal(s) dropped',
  'simulation.unknownKeys': 'These keys are not in the release and were ignored: {keys}',
  'simulation.minimal': 'Removing {keys} lifts the no-go.',
  'simulation.minimalUnproven': 'Removing {keys} lifts the no-go (smallest set found, not proven minimal).',
  'simulation.simulations': '{count} simulation(s)',
  'simulation.disclaimer': 'Simulation only: nothing is changed in Jira.',
  'diff.title': 'Since the last dossier',
  'diff.first': 'Only one dossier so far: nothing to compare yet.',
  'diff.none': 'No change since the last dossier.',
  'diff.added': 'New signals',
  'diff.cleared': 'Cleared signals',
  'diff.severity': 'Severity changed',

  'simulation.noSolution': 'No subset of tickets removes all blocking signals (check version-level freezes).',

  // dérogations
  'waiver.reason.required': 'A waiver needs a business reason: the request about signal {signalCode} was refused.',
  'waiver.approver.unauthorized': '{approver} is not allowed to grant or close a waiver.',
  'waiver.hours.invalid': 'Invalid waiver duration ({hours} h): expected between 1 and 720 hours.',
  'waiver.notFound': 'No waiver with id “{waiverId}” is recorded.',
  'waiver.alreadyClosed': 'Waiver “{waiverId}” is already closed (since {closedAt}).',
};

export const DICTIONARY_FR: Record<string, string> = {
  // Avis
  'verdict.go': 'GO',
  'verdict.conditional-go': 'GO SOUS CONDITIONS',
  'verdict.no-go': 'NO-GO',
  'verdict.not-applicable': 'SANS OBJET',

  // Confiance
  'confidence.high': 'Confiance haute',
  'confidence.medium': 'Confiance moyenne',
  'confidence.low': 'Confiance basse',
  'confidence.low.detail':
    'Je ne vois aucun commit pour {missing} tickets sur {total} : soit le dépôt n’est pas relié à Jira, soit rien n’a été codé.',

  // Gravités
  'severity.blocking': 'Bloquant',
  'severity.major': 'Majeur',
  'severity.minor': 'Mineur',
  'severity.info': 'Information',

  // Sources
  'signal.source.jira': 'Jira (recherche sur fixVersion)',
  'signal.source.dev': 'Teamwork Graph ou JQL development[...]',
  'signal.source.graph': 'Teamwork Graph',
  'signal.source.jiraHistory': 'Historique du ticket',
  'signal.source.jiraLinks': 'Liens Jira',
  'signal.source.compass': 'Compass et correspondance composant',
  'signal.source.jsm': 'Incidents Jira Service Management',
  'signal.source.freeze': 'Calendrier des gels de déploiement',
  'signal.source.jiraVersions': 'Versions Jira du projet',
  'signal.source.confluence': 'Pages Confluence liées',
  'signal.source.pastOutcomes': 'Bilans à 72 h passés',

  // Catalogue FR
  'signal.comp01.title': 'Ticket de la version non terminé',
  'signal.comp01.why': 'Livrer avec des travaux en cours expose les utilisateurs à des fonctionnalités incomplètes.',
  'signal.comp01.clear': 'Passer le ticket à Terminé, ou le retirer de la version dans Jira.',
  'signal.comp01.finding': 'Le ticket {key} est encore {status} ({category}).',

  'signal.comp02.title': 'Ticket terminé sans aucun commit ni PR',
  'signal.comp02.why': 'Un ticket marqué terminé sans trace de code peut être administratif, ou non relié au dépôt.',
  'signal.comp02.clear': 'Relier les commits ou la PR à {key}, ou noter qu’aucun code n’était requis.',
  'signal.comp02.finding': 'Le ticket {key} est Terminé mais ne compte ni commit ni pull request.',

  'signal.comp03.title': 'PR encore ouverte sur un ticket de la version',
  'signal.comp03.why': 'Une PR non fusionnée signifie que le code en production ne correspondra pas au ticket.',
  'signal.comp03.clear': 'Fusionner ou fermer la PR sur {key}, ou retirer le ticket de la version.',
  'signal.comp03.finding': 'Le ticket {key} a {count} pull request(s) encore ouverte(s).',

  'signal.comp04.title': 'Ticket ajouté à la version depuis moins de 48 h',
  'signal.comp04.why': 'Les ajouts tardifs sont le premier vecteur de régressions et de tests bâclés.',
  'signal.comp04.clear': 'Vérifier la couverture des tests de {key}, ou accorder une dérogation motivée.',
  'signal.comp04.finding': 'Le ticket {key} a rejoint la version il y a {hours} h (moins de 48 h).',

  'signal.qual01.title': 'Dernier build en échec sur un ticket de la version',
  'signal.qual01.why': 'Un build rouge indique que les derniers artefacts n’ont pas passé l’intégration continue.',
  'signal.qual01.clear': 'Corriger le build sur {key} et rendre la CI verte, ou annuler le commit.',
  'signal.qual01.finding': 'Le dernier build sur le ticket {key} est en échec ({count} build(s) rouge(s)).',

  'signal.qual02.title': 'PR fusionnée sans approbation',
  'signal.qual02.why': 'La relecture par les pairs évite les anomalies critiques ; livrer sans relecture augmente le risque.',
  'signal.qual02.clear': 'Faire une relecture a posteriori de {key}, ou accorder une dérogation.',
  'signal.qual02.finding': 'Le ticket {key} compte {count} PR(s) fusionnée(s) sans approbation requise.',

  'signal.qual03.title': 'Bug rouvert pendant le cycle',
  'signal.qual03.why': 'Un bug rouvert trahit une correction instable, qui casse fréquemment une seconde fois.',
  'signal.qual03.clear': 'Vérifier qu’un test de non-régression a été ajouté pour {key}.',
  'signal.qual03.finding': 'Le bug {key} a été rouvert au moins une fois pendant ce cycle de release.',

  'signal.dep01.title': 'Ticket bloqué par un ticket encore ouvert',
  'signal.dep01.why': 'Si une dépendance n’est pas prête, la fonctionnalité ne pourra pas marcher en production.',
  'signal.dep01.clear': 'Résoudre le bloquant {blockerKey}, ou retirer {key} de la version.',
  'signal.dep01.finding': 'Le ticket {key} est bloqué par {blockerKey}, encore {blockerStatus}.',

  'signal.dep02.title': 'Ticket d’un autre projet qui dépend de cette version',
  'signal.dep02.why': 'Une autre équipe s’appuie sur cette release ; elle doit être prévenue avant la coupure.',
  'signal.dep02.clear': 'Prévenir l’équipe de {targetKey} que la livraison est imminente.',
  'signal.dep02.finding': 'Le ticket {targetKey} ({projectKey}) dépend du ticket {key} de cette version.',

  'signal.dep03.title': 'Service dépendant dont l’équipe n’a aucun ticket lié',
  'signal.dep03.why': 'Le service {service} dépend de cette release mais son équipe n’a aucun ticket de suivi.',
  'signal.dep03.clear': 'Contacter le responsable du service, ou créer un ticket de synchronisation.',
  'signal.dep03.finding': 'Le service {service} est touché mais son équipe propriétaire n’a aucun ticket lié.',

  'signal.exp01.title': 'Incident ouvert sur un service touché',
  'signal.exp01.why': 'Livrer pendant un incident complique le diagnostic et risque d’aggraver l’interruption.',
  'signal.exp01.clear': 'Attendre la résolution de {incidentKey}, ou découpler la livraison de {service}.',
  'signal.exp01.finding': 'Incident {incidentKey} ouvert sur le service {service} (touché par {issues}).',

  'signal.exp02.title': 'Incident résolu depuis moins de 7 jours sur un service touché',
  'signal.exp02.why': 'Un service qui sort d’un incident est fragilisé ; le risque de récidive est plus haut.',
  'signal.exp02.clear': 'Vérifier la stabilité du correctif sur {service}, ou accorder une dérogation.',
  'signal.exp02.finding': 'L’incident {incidentKey} a été résolu il y a {days} j sur {service} (moins de 7 j).',

  'signal.exp03.title': 'Gel de déploiement à la date prévue',
  'signal.exp03.why': 'La production est gelée (période commerciale, clôture) : aucun déploiement n’est autorisé.',
  'signal.exp03.clear': 'Repousser la livraison hors de la plage [{from} - {to}], ou obtenir une validation VP.',
  'signal.exp03.finding': 'La date prévue {date} tombe dans le gel « {freezeName} » ({from} - {to}).',

  'signal.exp04.title': 'Autre version prévue le même jour sur les mêmes services',
  'signal.exp04.why': 'Deux livraisons simultanées sur un service créent des courses et brouillent les alertes.',
  'signal.exp04.clear': 'Coordonner l’ordre de déploiement avec la version {siblingVersion}.',
  'signal.exp04.finding': 'La version {siblingVersion} livre aussi le {date} et touche le service {service}.',

  'signal.doc01.title': 'Page Confluence liée, non modifiée depuis le début du cycle',
  'signal.doc01.why': 'Une documentation obsolète entraîne des questions clients et des retours au support.',
  'signal.doc01.clear': 'Relire et mettre à jour « {pageTitle} », ou accorder une dérogation.',
  'signal.doc01.finding': 'La page « {pageTitle} » n’a pas été modifiée depuis le début du cycle ({cycleStart}).',

  'signal.hist01.title': 'Zone à risque : versions précédentes sur ce composant suivies d’incidents',
  'signal.hist01.why': 'L’historique à 72 h montre une fragilité récurrente après livraison sur ce service.',
  'signal.hist01.clear': 'Prévoir des tests d’enfumage renforcés et une astreinte dédiée au déploiement.',
  'signal.hist01.finding': 'Les livraisons passées sur {service} ont causé {count} incident(s) sous 72 h.',

  'signal.obj01.title': 'La version porte un objectif dont l’échéance approche',
  'signal.obj01.why': 'Éclaire l’enjeu métier sans peser sur la décision technique go/no-go.',
  'signal.obj01.clear': 'Signal informatif : aucune action requise.',
  'signal.obj01.finding': 'L’objectif « {milestone} » arrive à échéance le {due}.',

  // Preuves masquées et UI
  'evidence.restricted': '1 élément masqué (accès restreint)',
  'evidence.view': 'Voir la preuve',
  'simulation.bestSet': 'Retirer {count} ticket(s) ({keys}) permet de quitter le NO-GO.',
  'simulation.noSolution': 'Aucun sous-ensemble de tickets ne lève le no-go (vérifier les gels de calendrier).',
  // dérogations
  'waiver.reason.required': 'Une dérogation exige un motif : la demande sur le signal {signalCode} a été refusée.',
  'waiver.approver.unauthorized': '{approver} n’est pas habilité à accorder ou clore une dérogation.',
  'waiver.hours.invalid': 'Durée de dérogation invalide ({hours} h) : attendu entre 1 et 720 heures.',
  'waiver.notFound': 'Aucune dérogation enregistrée avec l’identifiant « {waiverId} ».',
  'waiver.alreadyClosed': 'La dérogation « {waiverId} » est déjà close (depuis {closedAt}).',

  // Simulation (RI-13) et differences (RI-14) - ajoutees le 11/11/2026
  'simulation.run': 'Simuler sans {keys}',
  'simulation.runMinimal': 'Retirer {count} ticket(s) pour lever le no-go',
  'simulation.dropped': '{count} signal(s) retiré(s)',
  'simulation.unknownKeys': 'Ces clés ne sont pas dans la version et ont été ignorées : {keys}',
  'simulation.minimal': 'Retirer {keys} permet de lever le no-go.',
  'simulation.minimalUnproven': 'Retirer {keys} permet de lever le no-go (plus petit ensemble trouvé, minimalité non prouvée).',
  'simulation.simulations': '{count} simulation(s)',
  'simulation.disclaimer': 'Simulation uniquement : rien n’est modifié dans Jira.',
  'diff.title': 'Depuis le dernier dossier',
  'diff.first': 'Un seul dossier pour l’instant : rien à comparer.',
  'diff.none': 'Aucun changement depuis le dernier dossier.',
  'diff.added': 'Nouveaux signaux',
  'diff.cleared': 'Signaux levés',
  'diff.severity': 'Gravité modifiée',
};

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  en: DICTIONARY_EN,
  fr: DICTIONARY_FR,
};

/** Interpolates {var} tokens in a string. */
export function formatTemplate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/** Translates a MessageRef to a localized string. Falls back to key name. */
export function t(ref: MessageRef, locale: Locale = 'en'): string {
  const dict = DICTIONARIES[locale] || DICTIONARY_EN;
  const raw = dict[ref.key] || DICTIONARY_EN[ref.key] || ref.key;
  return formatTemplate(raw, ref.params);
}
