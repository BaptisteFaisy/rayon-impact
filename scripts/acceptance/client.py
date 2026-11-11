#!/usr/bin/env python3
"""Clients HTTP du harnais de recette : Jira REST + webtrigger de lecture.

Style imposé par scripts/seed-demo-site.py : stdlib uniquement (urllib),
jetons lus dans ~/.atlassian-api-token (ou variables d'environnement),
aucun secret jamais affiché. Attentes bornées : `poll_until` (jusqu'à un
timeout explicite, pas de sleep fixe > 30 s — AGENTS).
"""
import base64
import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_SITE = "https://one-atlas-cndz.atlassian.net"
DEFAULT_EMAIL = "baptiste.faisy@gmail.com"
DEFAULT_PROJECT = "PAY"
DEFAULT_VERSION = "2.4"

#: Intervalle de sondage (s) — borné par construction (< 30 s, règle AGENTS).
POLL_INTERVAL = 10
#: Timeout par défaut d'un sondage de dossier (s) : la porte de recalcul
#: regroupe à 1/min et le consommateur prend ~20 s (docs/OPS.md §6).
POLL_TIMEOUT = 300


def read_secret(env_name, file_name):
    """Secret lu de l'environnement, sinon d'un fichier de la home. Vide = absent."""
    value = os.environ.get(env_name, "").strip()
    if value:
        return value
    path = pathlib.Path.home().joinpath(file_name)
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


class HarnessError(RuntimeError):
    """Échec lisible d'un cas de recette (jamais de secret dans le message)."""


def _http(url, method="GET", body=None, headers=None, timeout=60):
    """Un appel HTTP ; retourne (status, corps_json_ou_texte_tronqué)."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read().decode(errors="replace")
        try:
            return err.code, json.loads(raw)
        except ValueError:
            return err.code, raw[:300]


class JiraClient:
    """Jira REST du site : préparation des données et déclenchement des recalculs."""

    def __init__(self, site=DEFAULT_SITE, email=DEFAULT_EMAIL, token=None):
        self.site = site.rstrip("/")
        token = token if token is not None else read_secret("ATLASSIAN_API_TOKEN", ".atlassian-api-token")
        if not token:
            raise HarnessError(
                "Jeton Atlassian introuvable : poser ~/.atlassian-api-token (mode 600) "
                "ou exporter ATLASSIAN_API_TOKEN."
            )
        basic = base64.b64encode(f"{email}:{token}".encode()).decode()
        self.headers = {"Authorization": f"Basic {basic}", "Content-Type": "application/json"}

    def call(self, method, path, body=None):
        return _http(f"{self.site}{path}", method, body, self.headers)

    def require(self, method, path, body=None, expected=(200, 201, 204)):
        status, payload = self.call(method, path, body)
        if status not in expected:
            raise HarnessError(f"{method} {path} -> {status} : {str(payload)[:300]}")
        return payload

    # ------------------------------------------------------------ versions

    def find_version(self, project_key, version_name):
        """La version du projet par son nom ; HarnessError si absente."""
        versions = self.require("GET", f"/rest/api/3/project/{project_key}/versions")
        for version in versions if isinstance(versions, list) else []:
            if version.get("name") == version_name:
                return version
        raise HarnessError(f"Version {version_name!r} introuvable dans le projet {project_key}.")

    def project_id_of(self, project_key):
        project = self.require("GET", f"/rest/api/3/project/{project_key}")
        return str(project.get("id", ""))

    def touch_version(self, version_id, version_name):
        """PUT /rest/api/3/version/{id} : le vrai événement qui déclenche le
        recalcul (docs/OPS.md §6). Idempotent : même nom, aucune donnée changée."""
        self.require("PUT", f"/rest/api/3/version/{version_id}", {"name": version_name})

    # ------------------------------------------------------------ tickets

    def search_issues(self, jql):
        """(clé, résumé) des tickets d'une JQL (POST /search ; 50 max au harnais)."""
        # /rest/api/3/search a été supprimé (HTTP 410) : l'API de recherche est
        # désormais /rest/api/3/search/jql. L'app l'utilise déjà (jira-client.ts).
        payload = self.require(
            "POST", "/rest/api/3/search/jql",
            {"jql": jql, "fields": ["summary", "status"], "maxResults": 50},
        )
        return [(i["key"], i.get("fields", {}).get("summary", "")) for i in payload.get("issues", [])]

    def get_issue(self, key):
        return self.require("GET", f"/rest/api/3/issue/{key}?fields=status,summary,fixVersions")

    def issue_exists(self, key):
        status, _ = self.call("GET", f"/rest/api/3/issue/{key}?fields=summary")
        return status == 200

    def create_issue(self, project_key, summary, version_name):
        fields = {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": "Tâche"},
            "fixVersions": [{"name": version_name}],
        }
        created = self.require("POST", "/rest/api/3/issue", {"fields": fields}, expected=(201,))
        return created["key"]

    def status_category(self, key):
        issue = self.get_issue(key)
        return issue["fields"]["status"].get("statusCategory", {}).get("key", "")

    def transition_to_category(self, key, category):
        """Amène le ticket dans la catégorie de statut voulue ('indeterminate'
        = En cours, 'done' = Terminé). Découvre les ids de transition : jamais
        d'id en dur (contrairement au seed, le harnais doit rester rejouable)."""
        if self.status_category(key) == category:
            return False
        payload = self.require("GET", f"/rest/api/3/issue/{key}/transitions")
        for transition in payload.get("transitions", []):
            if transition.get("to", {}).get("statusCategory", {}).get("key") == category:
                self.require(
                    "POST", f"/rest/api/3/issue/{key}/transitions",
                    {"transition": {"id": transition["id"]}}, expected=(200, 204),
                )
                return True
        raise HarnessError(f"Aucune transition vers la catégorie {category!r} depuis {key}.")


class WebTriggerClient:
    """Lecture seule du dossier via le webtrigger de l'app (src/webtrigger.ts)."""

    def __init__(self, base_url, token=None):
        self.base_url = (base_url or "").rstrip("/")
        if not self.base_url:
            raise HarnessError(
                "URL du webtrigger manquante : --webtrigger-url, RAYON_WEBTRIGGER_URL "
                "ou ~/.rayon-webtrigger-url (produite par `forge webtrigger create`)."
            )
        self.token = token if token is not None else read_secret("RAYON_WEBTRIGGER_TOKEN", ".rayon-webtrigger-token")
        if not self.token:
            raise HarnessError(
                "Jeton du webtrigger manquant : exporter RAYON_WEBTRIGGER_TOKEN ou poser "
                "~/.rayon-webtrigger-token (même valeur que `forge variables set RI_WEBTRIGGER_TOKEN=…`)."
            )

    def get(self, route, query=None):
        """GET borné ; retourne (status, corps_json). N'affiche jamais le jeton."""
        url = f"{self.base_url}{route}"
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v})
        headers = {"Authorization": f"Bearer {self.token}"}
        return _http(url, "GET", None, headers)

    def health(self):
        status, payload = _http(f"{self.base_url}/health", "GET", None, {})
        return status, payload

    def dossier(self, version_id):
        status, payload = self.get("/dossier", {"versionId": version_id})
        return status, payload

    def snapshots(self, project_id, limit=50):
        return self.get("/snapshots", {"projectId": project_id, "limit": str(limit)})


def poll_until(probe, timeout=POLL_TIMEOUT, interval=POLL_INTERVAL, description="sondage"):
    """Attend jusqu'à `timeout` s que probe() rende une valeur vraie ; la
    retourne. HarnessError sinon. Jamais de sleep fixe > 30 s (règle AGENTS)."""
    interval = min(max(interval, 1), 30)
    deadline = time.monotonic() + timeout
    attempt = 0
    while True:
        attempt += 1
        result = probe()
        if result:
            return result
        if time.monotonic() >= deadline:
            raise HarnessError(f"{description} : toujours faux après {timeout} s ({attempt} sondages).")
        time.sleep(interval)


def elapsed_since(start_monotonic):
    """Secondes écoulées depuis un `time.monotonic()`."""
    return time.monotonic() - start_monotonic
