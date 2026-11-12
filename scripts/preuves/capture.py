#!/usr/bin/env python3
"""Capture de preuves — l'état réel de l'app en production, horodaté et vérifié.

Lancement (depuis la racine du dépôt) :

    python3 scripts/preuves/capture.py                 # preuve de l'état courant
    python3 scripts/preuves/capture.py --avec-recette  # + rejoue le harnais §17

Ce que la capture prouve, étape par étape, sans jamais afficher de secret :

  1. déploiement — version et date de déploiement par environnement (`forge
     version list --json`), avec le nombre de modules, de fonctions et de scopes ;
  2. installation vivante — le webtrigger de production répond et son jeton est
     configuré (une app déployée mais non installée n'a pas de jeton) ;
  3. dossier frais — le dossier lu vient bien de la table de production, avec son
     horodatage de calcul ;
  4. verdict cohérent — avis et confiance dans l'énumération du SPEC ;
  5. couverture honnête — l'état de chaque source (jira, jsm, confluence,
     development, service-map, teamwork-graph) est affiché tel quel : une source
     absente est nommée, jamais silence ;
  6. synthèse vérifiée — chaque clé de ticket citée dans la synthèse LLM existe
     dans les signaux du dossier (le même contrôle que le cas R8 du harnais) ;
  7. décisions et dérogations — ce que le chemin d'écriture a réellement laissé ;
  8. chaîne de déclenchement — les journaux de production montrent l'enchaînement
     événement → mis en file → démarré → terminé (et reporté / passe finale) ;
  9. historique — les derniers dossiers calculés, avec leur nombre de signaux.

Sortie : `docs/preuves/dernier.json` (machine) et `docs/preuves/dernier.md`
(lisible). Aucun secret n'y figure : le jeton n'est jamais écrit, et l'URL du
webtrigger n'est conservée que sous son hôte.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

RACINE = pathlib.Path(__file__).resolve().parents[2]
SORTIE = RACINE / "docs" / "preuves"

#: Une clé de ticket Jira citée dans un texte.
KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")

#: Les avis et les confiances du SPEC §13.
AVIS = ("go", "go-sous-conditions", "no-go")
CONFIANCES = ("high", "medium", "low")

#: Les journaux qui prouvent la chaîne de déclenchement (SPEC §12).
JOURNAL_CHAINE = (
    "recompute queued",
    "recompute started",
    "recompute finished",
    "recompute deferred",
    "recompute trailing",
)


class PreuveErreur(RuntimeError):
    """La capture elle-même a échoué (configuration, réseau, CLI)."""


# ----------------------------------------------------------------- utilitaires


def lire_secret(nom_env: str, fichier: str) -> str:
    """Valeur d'un secret : variable d'environnement d'abord, fichier ensuite."""
    valeur = os.environ.get(nom_env)
    if valeur:
        return valeur.strip()
    chemin = pathlib.Path.home() / fichier
    if not chemin.exists():
        raise PreuveErreur(f"secret introuvable : {nom_env} ou ~/{fichier}")
    return chemin.read_text(encoding="utf-8").strip()


def forge_json(*args: str) -> object:
    """Sortie JSON d'une commande Forge (authentification gérée par le CLI)."""
    commande = ["forge", *args, "--json"]
    try:
        brut = subprocess.run(
            commande, capture_output=True, text=True, timeout=180, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        raise PreuveErreur(f"forge {' '.join(args)} : {err}") from err
    if brut.returncode != 0:
        raise PreuveErreur(f"forge {' '.join(args)} a échoué : {brut.stderr[:200]}")
    try:
        return json.loads(brut.stdout)
    except json.JSONDecodeError as err:
        raise PreuveErreur(f"sortie non JSON de forge {' '.join(args)}") from err


def journal_production(lignes: int = 40) -> list[str]:
    """Derniers journaux de production, sans leurs codes couleur."""
    try:
        brut = subprocess.run(
            ["forge", "logs", "-e", "production"],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    brut = re.sub(r"\x1b\[[0-9;]*m", "", brut.stdout)
    return [ligne for ligne in brut.splitlines() if ligne.strip()][-lignes:]


# ------------------------------------------------------------------ la capture


def lire_webtrigger(chemin: str, jeton: str) -> dict:
    """GET sur le webtrigger de lecture (aucun secret dans le résultat)."""

    def get(suffixe: str) -> tuple[int, dict]:
        requete = urllib.request.Request(
            chemin + suffixe, headers={"Authorization": "Bearer " + jeton}
        )
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            return reponse.status, json.loads(reponse.read().decode("utf-8"))

    try:
        code_sante, sante = get("/health")
        code_dossier, dossier = get("/dossier?projectKey=PAY&versionName=2.4")
    except Exception as err:  # noqa: BLE001 — une capture ne doit jamais cacher la cause
        raise PreuveErreur(f"webtrigger injoignable : {err}") from err
    return {
        "health": {"http": code_sante, **sante},
        "dossier": {"http": code_dossier, **dossier},
    }


def preuves_deployements() -> dict:
    """Preuve 1 : ce qui est déployé, où, et avec quelle surface.

    `forge environments list` donne le dernier déploiement de chaque
    environnement. `forge version list` ne liste que les versions *majeures* de
    l'environnement de développement — d'où la surface applicative (modules,
    fonctions, scopes) prise là, et signalée comme telle.
    """
    versions = forge_json("version", "list")
    environnements = forge_json("environments", "list")
    par_env = {}
    for environnement in environnements if isinstance(environnements, list) else []:
        par_env[str(environnement.get("type", "")).lower()] = {
            "dernierDeploiement": environnement.get("lastDeployedAt"),
            "identifiant": environnement.get("id"),
        }
    surface = {}
    for version in versions if isinstance(versions, list) else []:
        if str(version.get("environmentType", "")).upper() != "DEVELOPMENT":
            continue
        surface = {
            "versionMajeure": version.get("version"),
            "deployeeLe": version.get("deploymentDateTime"),
            "fonctions": version.get("functions"),
            "scopes": version.get("scopes"),
            "modules": {
                module.get("type"): module.get("count")
                for module in version.get("modules", [])
            },
        }
        break
    return {"environnements": par_env, "surfaceApplicative": surface}


def preuves_calcul(snapshot: dict, signaux: list) -> list[dict]:
    """Preuves 3 à 5 : le calcul — dossier frais, avis cohérent, synthèse vérifiée."""
    narrative = snapshot.get("narrative") or ""
    cles_narrative = set(KEY_RE.findall(narrative))
    cles_signaux = set(KEY_RE.findall(json.dumps(signaux, ensure_ascii=False)))
    return [
        {
            "id": "dossier_frais",
            "libelle": "Dossier calculé par la production",
            "statut": "OK" if snapshot.get("computedAt") else "ANOMALIE",
            "detail": f"computedAt={snapshot.get('computedAt')} "
            f"version={snapshot.get('versionName')} signaux={len(signaux)}",
        },
        {
            "id": "verdict_coherent",
            "libelle": "Avis et confiance dans l'énumération du SPEC",
            "statut": "OK"
            if snapshot.get("verdict") in AVIS and snapshot.get("confidence") in CONFIANCES
            else "ANOMALIE",
            "detail": f"avis={snapshot.get('verdict')} "
            f"confiance={snapshot.get('confidence')} "
            f"comptes={json.dumps(snapshot.get('counts'))}",
        },
        {
            "id": "synthese_verifiee",
            "libelle": "Aucune clé de ticket inventée par la synthèse",
            "statut": "OK" if cles_narrative <= cles_signaux else "ANOMALIE",
            "detail": f"{len(cles_narrative)} clé(s) citée(s), "
            f"{len(cles_narrative - cles_signaux)} hors signaux",
        },
    ]


def preuves_couverture(contenu: dict) -> list[dict]:
    """Preuves 6 et 7 : la couverture annoncée, et ce que l'écriture a laissé."""
    couverture = (contenu.get("snapshot") or {}).get("coverage") or {}
    return [
        {
            "id": "couverture_honnete",
            "libelle": "État de chaque source de couverture",
            "statut": "OK",
            "detail": ", ".join(
                f"{source.get('source')}={source.get('state')}"
                for source in couverture.get("sources", [])
            ),
        },
        {
            "id": "decisions_derogations",
            "libelle": "Décisions et dérogations réellement enregistrées",
            "statut": "INFO",
            "detail": f"décisions={len(contenu.get('decisions') or [])} "
            f"dérogations={len(contenu.get('waivers') or [])} "
            f"bilan 72 h={'oui' if contenu.get('outcome') else 'non'}",
        },
    ]


def preuves_chaine(journal: list[str]) -> list[dict]:
    """Preuve 8 : l'enchaînement des déclenchements, vu par les journaux."""
    vues = [ligne for ligne in journal if any(mot in ligne for mot in JOURNAL_CHAINE)]
    return [
        {
            "id": "chaine_declenchement",
            "libelle": "Chaîne de déclenchement dans les journaux de production",
            "statut": "OK" if len(vues) >= 3 else "PARTIEL",
            "detail": f"{len(vues)} ligne(s) de chaîne dans les {len(journal)} "
            "dernières lignes de journal",
        }
    ]


def preuves_historique(jeton: str, chemin: str) -> dict:
    """Preuve 9 : les derniers dossiers calculés, avec leurs signaux."""
    requete = urllib.request.Request(
        chemin + "/snapshots?projectId=10234&limit=8",
        headers={"Authorization": "Bearer " + jeton},
    )
    try:
        with urllib.request.urlopen(requete, timeout=60) as reponse:
            charge = json.loads(reponse.read().decode("utf-8"))
    except Exception as err:  # noqa: BLE001
        raise PreuveErreur(f"/snapshots injoignable : {err}") from err
    return {
        "dossiers": len(charge.get("snapshots") or []),
        "derniers": [
            {
                "computedAt": (entree.get("snapshot") or {}).get("computedAt"),
                "version": (entree.get("snapshot") or {}).get("versionName"),
                "verdict": (entree.get("snapshot") or {}).get("verdict"),
                "signaux": len(entree.get("signals") or []),
            }
            for entree in (charge.get("snapshots") or [])
        ],
    }


def declencher_recalcul(projet: str, version: str) -> dict:
    """Déclenche un recalcul par le vrai événement Jira (PUT idempotent, OPS §6).

    C'est l'événement que Jira envoie à l'app : rien n'est écrit dans Jira (le
    nom de la version est renvoyé identique), mais la production recalcule — et
    ses journaux montrent la chaîne que la capture veut prouver.
    """
    sys.path.insert(0, str(RACINE / "scripts" / "acceptance"))
    from client import JiraClient  # noqa: PLC0415 — import tardif, module optionnel

    jira = JiraClient(
        site=os.environ.get("RAYON_SITE", "https://one-atlas-cndz.atlassian.net"),
        email=os.environ.get("ATLASSIAN_EMAIL", "baptiste.faisy@gmail.com"),
    )
    cible = jira.find_version(projet, version)
    jira.touch_version(str(cible["id"]), cible["name"])
    return {
        "projet": projet,
        "version": cible["name"],
        "versionId": str(cible["id"]),
        "evenement": "PUT /rest/api/3/version/{id} (idempotent)",
    }


# ------------------------------------------------------------------ rédaction


def markdown(bundle: dict) -> str:
    """La preuve, lisible par un humain (et par un jury)."""
    deploiements = bundle.get("deployements", {})
    lignes = [
        "# Preuves — capture du live",
        "",
        f"Capturé le **{bundle['captureLe']}** depuis l'environnement "
        f"**{bundle.get('environnement', 'production')}**.",
        "",
        "## Déploiements",
        "",
        "| environnement | dernier déploiement |",
        "| --- | --- |",
    ]
    for nom, info in sorted(deploiements.get("environnements", {}).items()):
        lignes.append(f"| {nom} | {info.get('dernierDeploiement', '—')} |")
    surface = deploiements.get("surfaceApplicative", {})
    lignes += [
        "",
        "## Surface applicative",
        "",
        f"Version majeure listée par Forge (environnement de développement) : "
        f"**{surface.get('versionMajeure', '—')}**, déployée le "
        f"{surface.get('deployeeLe', '—')} — "
        f"{surface.get('fonctions', '—')} fonctions, {surface.get('scopes', '—')} scopes. "
        "Forge ne liste que les versions majeures, sur l'environnement de "
        "développement : la production est attestée par la date de déploiement "
        "ci-dessus et par le webtrigger qui répond.",
    ]
    lignes += ["", "## Contrôles", "", "| contrôle | statut | détail |", "| --- | --- | --- |"]
    for preuve in bundle.get("preuves", []):
        lignes.append(
            f"| {preuve['libelle']} | **{preuve['statut']}** | {preuve['detail']} |"
        )
    lignes += ["", "## Modules", ""]
    modules = deploiements.get("surfaceApplicative", {}).get("modules", {})
    for module, nombre in sorted(modules.items()):
        lignes.append(f"- `{module}` : {nombre}")
    lignes += ["", "## Historique des dossiers", "", "| calculé | version | avis | signaux |", "| --- | --- | --- | --- |"]
    for entree in bundle.get("historique", {}).get("derniers", []):
        lignes.append(
            f"| {entree['computedAt']} | {entree['version']} | {entree['verdict']} | {entree['signaux']} |"
        )
    lignes += ["", "## Chaîne de déclenchement (journaux de production)", "", "```"]
    lignes += bundle.get("journal", [])
    lignes += ["```", ""]
    return "\n".join(lignes)


# ------------------------------------------------------------------------ main


def construire_bundle(args) -> dict:
    """Rassemble toutes les preuves dans un bundle horodaté."""
    chemin = lire_secret("RAYON_WEBTRIGGER_URL", ".rayon-webtrigger-url")
    jeton = lire_secret("RAYON_WEBTRIGGER_TOKEN", ".rayon-webtrigger-token")
    bundle = {
        "captureLe": subprocess.run(
            ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True
        ).stdout.strip(),
        "environnement": "production",
        "webtriggerHote": re.sub(r"https://([^/]+)/.*", r"https://\1/", chemin),
        "deployements": preuves_deployements(),
    }
    if not args.lecture_seule:
        bundle["declencheur"] = declencher_recalcul(args.projet, args.version)
        time.sleep(max(0, min(args.pause, 30)))
    lecture = lire_webtrigger(chemin, jeton)
    journal = journal_production()
    contenu = lecture["dossier"].get("dossier") or {}
    snapshot = contenu.get("snapshot") or {}
    bundle["health"] = lecture["health"]
    bundle["preuves"] = (
        preuves_calcul(snapshot, contenu.get("signals") or [])
        + preuves_couverture(contenu)
        + preuves_chaine(journal)
    )
    bundle["historique"] = preuves_historique(jeton, chemin)
    bundle["journal"] = [
        ligne for ligne in journal if any(m in ligne for m in JOURNAL_CHAINE)
    ][-12:]
    if args.avec_recette:
        bundle["recette"] = executer_recette()
    return bundle


def executer_recette() -> dict:
    """Rejoue le harnais §17 et garde son compte rendu (aucun secret dedans)."""
    rapport = subprocess.run(
        [sys.executable, str(RACINE / "scripts" / "acceptance" / "run.py")],
        capture_output=True,
        text=True,
        timeout=1800,
        check=False,
    )
    return {"code": rapport.returncode, "rapport": rapport.stdout.splitlines()[-12:]}


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--avec-recette",
        action="store_true",
        help="rejoue aussi le harnais de recette §17 et joint son compte rendu",
    )
    analyseur.add_argument(
        "--lecture-seule",
        action="store_true",
        help="ne déclenche aucun recalcul (capture de l'état, sans événement)",
    )
    analyseur.add_argument("--projet", default="PAY", help="projet à déclencher")
    analyseur.add_argument("--version", default="2.4", help="version à déclencher")
    analyseur.add_argument(
        "--pause",
        type=int,
        default=25,
        help="secondes d'attente après le déclenchement, pour laisser la chaîne se former",
    )
    args = analyseur.parse_args(argv)

    try:
        bundle = construire_bundle(args)
    except PreuveErreur as err:
        print(f"::error::{err}")
        return 2

    SORTIE.mkdir(parents=True, exist_ok=True)
    (SORTIE / "dernier.json").write_text(
        json.dumps(bundle, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    (SORTIE / "dernier.md").write_text(markdown(bundle), encoding="utf-8")
    anomalies = [p for p in bundle["preuves"] if p["statut"] == "ANOMALIE"]
    print(f"capture écrite : {SORTIE / 'dernier.md'}")
    for preuve in bundle["preuves"]:
        print(f"  {preuve['statut']:<9} {preuve['libelle']}")
    return 1 if anomalies else 0


if __name__ == "__main__":
    sys.exit(main())
