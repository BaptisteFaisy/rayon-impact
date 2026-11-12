import type { ImpactedTeam, Locale } from '../../types';
import { List, ListItem, Text, Strong } from '../kit';

/**
 * Impacted teams tab: who is touched, through which services, and with which
 * tickets (SPEC §6.3, RI-12).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function TeamsTab({ teams, locale }: { teams: ImpactedTeam[]; locale: Locale }) {
  if (teams.length === 0) {
    return (
      <Text>
        {locale === 'fr' ? 'Aucune équipe identifiée.' : 'No team identified.'}
      </Text>
    );
  }
  return (
    <List type="unordered">
      {teams.map((team) => (
        <TeamRow key={team.teamId} team={team} />
      ))}
    </List>
  );
}

function TeamRow({ team }: { team: ImpactedTeam }) {
  return (
    <ListItem>
      <Strong>{team.teamName}</Strong> —{' '}
      {team.services.map((service) => service.serviceName).join(', ')} ({team.via})
      <List type="unordered">
        {team.issues.map((issue) => (
          <ListItem key={issue.key}>
            {issue.key} — {issue.summary}
          </ListItem>
        ))}
      </List>
    </ListItem>
  );
}
