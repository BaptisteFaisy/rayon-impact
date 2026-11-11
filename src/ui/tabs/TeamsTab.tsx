import type { ImpactedTeam, Locale } from '../../types.js';

/**
 * Impacted teams tab: who is touched, through which services, and with which
 * tickets (SPEC §6.3, RI-12).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function TeamsTab({ teams, locale }: { teams: ImpactedTeam[]; locale: Locale }) {
  if (teams.length === 0) {
    return (
      <p style={{ color: '#6B778C' }}>
        {locale === 'fr' ? 'Aucune équipe identifiée.' : 'No team identified.'}
      </p>
    );
  }
  return (
    <ul>
      {teams.map((team) => (
        <TeamRow key={team.teamId} team={team} />
      ))}
    </ul>
  );
}

function TeamRow({ team }: { team: ImpactedTeam }) {
  return (
    <li>
      <strong>{team.teamName}</strong> —{' '}
      {team.services.map((service) => service.serviceName).join(', ')} ({team.via})
      <ul>
        {team.issues.map((issue) => (
          <li key={issue.key}>
            {issue.key} — {issue.summary}
          </li>
        ))}
      </ul>
    </li>
  );
}
