"""Auto-test du harnais de recette : `trigger_recompute` face au regroupement.

Lancement : `python3 -m unittest discover -s tests/scripts -t .` (stdlib
`unittest`, aucun pytest). Aucun réseau, aucun sleep réel : `poll_until` et
l'horloge sont bouchonnés, le fichier entier s'exécute en quelques millisecondes.

Pourquoi ces cas : l'app regroupe les recalculs (SPEC §12 — au plus un par
minute et par version), donc un PUT qui tombe dans la fenêtre ne produit aucun
snapshot. Avant le re-PUT, deux cas de recette enchaînés en moins d'une minute
faisaient échouer le second après tout son timeout (observé sur R6 en
production : « R6 précondition : toujours faux après 300 s »).
"""

from __future__ import annotations

import pathlib
import sys
import unittest
from unittest import mock

RACINE = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE / "scripts" / "acceptance"))

import cases as harnais  # noqa: E402
from client import HarnessError  # noqa: E402


class JiraFaux:
    """Compte les PUT de version ; aucun appel réseau."""

    def __init__(self) -> None:
        self.puts = 0

    def touch_version(self, version_id, version_name) -> None:
        self.puts += 1


class CtxFaux:
    """Le strict minimum de `cases.Ctx` que `trigger_recompute` utilise."""

    def __init__(self, timeout: int = 300) -> None:
        self.jira = JiraFaux()
        self.version_id = "10100"
        self.version_name = "2.4"
        self.timeout = timeout


class AttenteBouchon:
    """Remplace `cases.poll_until` : rejoue un scénario scripté, sans dormir.

    Chaque appel rend la réponse suivante de `issues` (une valeur = snapshot
    trouvé, une exception = attente épuisée). Les timeouts reçus sont consignés
    pour être assertés.
    """

    def __init__(self, issues) -> None:
        self.issues = list(issues)
        self.timeouts: list[int] = []

    def __call__(self, sonde, timeout=None, interval=None, description="sondage"):
        self.timeouts.append(timeout)
        if not self.issues:
            raise AssertionError("poll_until appelé plus de fois que scripté")
        suite = self.issues.pop(0)
        if isinstance(suite, BaseException):
            raise suite
        return suite


class HorlogeFausse:
    """`monotonic()` piloté : rend les valeurs scriptées, puis la dernière."""

    def __init__(self, valeurs) -> None:
        self.valeurs = list(valeurs)
        self.lues = 0

    def monotonic(self) -> float:
        valeur = self.valeurs[min(self.lues, len(self.valeurs) - 1)]
        self.lues += 1
        return float(valeur)


def dossier(stamp: str) -> dict:
    """Un dossier réduit à ce que le harnais regarde : l'horodatage."""
    return {"snapshot": {"computedAt": stamp}}


class TriggerRecomputeTest(unittest.TestCase):
    def lance(self, ctx, issues, horloge):
        """`trigger_recompute` avec l'attente et l'horloge bouchonnées."""
        with mock.patch.object(harnais, "poll_until", AttenteBouchon(issues)) as attente, \
                mock.patch.object(harnais, "time", horloge):
            resultat = harnais.trigger_recompute(ctx, "2026-11-12T10:00:00.000Z")
        return resultat, attente

    def test_un_seul_put_quand_le_snapshot_arrive(self):
        ctx = CtxFaux()
        resultat, attente = self.lance(
            ctx, [dossier("2026-11-12T10:05:00.000Z")], HorlogeFausse([1000])
        )
        self.assertEqual(1, ctx.jira.puts)
        self.assertEqual("2026-11-12T10:05:00.000Z", resultat["snapshot"]["computedAt"])
        self.assertEqual([harnais.REPUTE_AFTER_SECONDS], attente.timeouts)

    def test_re_put_quand_le_premier_tombe_dans_la_fenetre(self):
        ctx = CtxFaux()
        epuise = HarnessError("recalcul : toujours faux après 95 s")
        resultat, attente = self.lance(
            ctx,
            [epuise, dossier("2026-11-12T10:07:00.000Z")],
            HorlogeFausse([1000, 1010, 1020, 1105, 1115]),
        )
        self.assertEqual(2, ctx.jira.puts)
        self.assertEqual("2026-11-12T10:07:00.000Z", resultat["snapshot"]["computedAt"])
        self.assertEqual([harnais.REPUTE_AFTER_SECONDS] * 2, attente.timeouts)

    def test_attente_bornee_par_le_reste_du_timeout_du_cas(self):
        ctx = CtxFaux(timeout=50)
        _, attente = self.lance(
            ctx, [dossier("2026-11-12T10:09:00.000Z")], HorlogeFausse([1000])
        )
        self.assertEqual([50], attente.timeouts)

    def test_abandon_au_timeout_du_cas_avec_le_nombre_de_put(self):
        ctx = CtxFaux(timeout=300)
        epuise = HarnessError("recalcul : toujours faux après 95 s")
        with mock.patch.object(harnais, "poll_until", AttenteBouchon([epuise] * 4)), \
                mock.patch.object(harnais, "time", HorlogeFausse([1000, 1100, 1200, 1300, 1400])):
            with self.assertRaises(HarnessError) as leve:
                harnais.trigger_recompute(ctx, "2026-11-12T10:00:00.000Z")
        message = str(leve.exception)
        self.assertIn("300 s", message)
        self.assertIn("2 PUT", message)
        self.assertEqual(2, ctx.jira.puts)


if __name__ == "__main__":
    unittest.main()
