#!/usr/bin/env python3
"""Compte rendu du harnais : une ligne par cas R1…R8, OK / ÉCHEC / SAUTÉ + raison.

Aucun secret n'y apparaît (les clients ne remontent que statuts et extraits de
corps de réponse, jamais les en-têtes d'authentification).
"""
import sys

from cases import ECHEC, OK, SAUTE

#: Largeur de la colonne d'état (les accents comptent pour 1 en terminal).
_STATUS_WIDTH = 6


def format_report(results, site, project, version_name):
    """Le texte final : en-tête de cible, table des cas, synthèse chiffrée."""
    lines = [
        "",
        f"Harnais de recette — SPEC §17 — {site} {project} {version_name}",
        "=" * 72,
    ]
    lines += [format_case(result) for result in results]
    lines += ["-" * 72, summary_line(results), ""]
    return "\n".join(lines)


def format_case(result):
    name = getattr(result, "name", "?")
    spec_ref = getattr(result, "spec_ref", "")
    head = f"{name} {spec_ref} [{result.status}]".ljust(24)
    reason = result.reason or ("—" if result.status == OK else "")
    return f"{head} {reason}"


def summary_line(results):
    counts = {status: sum(1 for r in results if r.status == status) for status in (OK, ECHEC, SAUTE)}
    return (
        f"Synthèse : {counts[OK]} OK, {counts[ECHEC]} ÉCHEC, {counts[SAUTE]} SAUTÉ "
        f"sur {len(results)} cas."
    )


def exit_code(results):
    """Non nul si un cas échoue ; les cas SAUTÉS ne sont pas des échecs."""
    return 1 if any(r.status == ECHEC for r in results) else 0


def fatal(message):
    """Erreur bloquante du harnais lui-même (configuration, pas un cas)."""
    print(f"ERREUR HARNAIS : {message}", file=sys.stderr)
    return 2
