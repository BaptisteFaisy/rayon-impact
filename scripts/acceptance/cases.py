#!/usr/bin/env python3
"""Les 8 points de recette du SPEC §17, chacun devenu un cas nommé R1…R8.

Un cas prépare ses données dans Jira (tickets `[acc-Rn]` idempotents),
déclenche le recalcul comme docs/OPS.md §6 (PUT /rest/api/3/version/{id}),
sonde le webtrigger de lecture en attente bornée, puis affirme.

Automatisables sans navigateur : R1, R5, R6, R8. Les autres sont SAUTÉS avec
la raison exacte (écran de réglages, action de dérogation, identité du
lecteur, agent Rovo — tout cela passe par le navigateur, cf. docs/ACCEPTANCE.md).
Un cas échoué n'arrête pas les suivants (géré par run.py).
"""
import json
import os
import pathlib
import re
import time

from client import HarnessError, elapsed_since, poll_until

OK = "OK"
ECHEC = "ÉCHEC"
SAUTE = "SAUTÉ"

#: Une clé de ticket Jira citée dans un texte (narrative, params, URL).
KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")

#: R6 : le SPEC §17.6 exige < 2 min ; on sonde un peu plus large, on juge à 120 s.
R6_JUDGE_SECONDS = 120
R6_POLL_SECONDS = 150


class CaseResult:
    """Verdict d'un cas : OK, ÉCHEC (raison) ou SAUTÉ (raison)."""

    def __init__(self, status, reason=""):
        self.status = status
        self.reason = reason


class Ctx:
    """Contexte partagé des cas : clients, version cible, état idempotent."""

    def __init__(self, jira, webtrigger, project, version_name, timeout):
        self.jira = jira
        self.webtrigger = webtrigger
        self.project = project
        self.version_name = version_name
        self.timeout = timeout
        version = jira.find_version(project, version_name)
        self.version_id = str(version["id"])
        self.project_id = jira.project_id_of(project)
        cache = pathlib.Path(os.environ.get("XDG_CACHE_HOME", pathlib.Path.home() / ".cache"))
        self.state_path = cache / "rayon-acceptance" / f"state-{project}-{version_name}.json"
        self.state = self._load_state()

    def _load_state(self):
        if self.state_path.exists():
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            except ValueError:
                return {}
        return {}

    def save_state(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(self.state, indent=1), encoding="utf-8")


# ------------------------------------------------------------ lecture dossier

def read_dossier(ctx):
    """Le dossier sauvé de la version cible, ou None s'il n'existe pas encore."""
    status, payload = ctx.webtrigger.dossier(ctx.version_id)
    if status == 200 and payload.get("ok"):
        return payload.get("dossier")
    if status == 404:
        return None
    raise HarnessError(f"webtrigger /dossier -> {status} : {str(payload)[:200]}")


def computed_at(dossier):
    return (dossier or {}).get("snapshot", {}).get("computedAt")


def wait_snapshot(ctx, previous, timeout=None, description="recalcul"):
    """Sonde jusqu'à un snapshot plus récent que `previous` (None = attendre l'existence)."""
    def fresh():
        dossier = read_dossier(ctx)
        stamp = computed_at(dossier)
        return dossier if stamp and stamp != previous else None
    return poll_until(fresh, timeout or ctx.timeout, description=description)


def trigger_recompute(ctx, previous, description="recalcul sur PUT version"):
    """Le vrai événement Jira qui déclenche le recalcul (docs/OPS.md §6)."""
    ctx.jira.touch_version(ctx.version_id, ctx.version_name)
    return wait_snapshot(ctx, previous, description=description)


def comp01_citing(dossier, issue_key):
    """Le signal COMP-01 qui cite `issue_key` (finding.params.key, src/signals/comp.ts)."""
    for signal in (dossier or {}).get("signals", []):
        if signal.get("code") != "COMP-01":
            continue
        params = (signal.get("finding") or {}).get("params") or {}
        if params.get("key") == issue_key:
            return signal
    return None


def signal_codes(dossier):
    return sorted({s.get("code", "?") for s in (dossier or {}).get("signals", [])})


# ------------------------------------------------------------- préparation Jira

def ensure_issue(ctx, tag, summary_suffix):
    """Le ticket `[acc-<tag>]` de la version : retrouvé s'il existe, créé sinon."""
    marker = f"[acc-{tag}]"
    cached = ctx.state.get(tag)
    if cached and ctx.jira.issue_exists(cached):
        return cached
    jql = f'project = {ctx.project} AND fixVersion = "{ctx.version_name}" AND summary ~ "acc-{tag}"'
    for key, summary in ctx.jira.search_issues(jql):
        if summary.startswith(marker):
            ctx.state[tag] = key
            ctx.save_state()
            return key
    key = ctx.jira.create_issue(ctx.project, f"{marker} {summary_suffix}", ctx.version_name)
    ctx.state[tag] = key
    ctx.save_state()
    return key


# ------------------------------------------------------------------------ cas

def case_r1(ctx):
    """§17.1 : ticket « En cours » → avis no-go et COMP-01 cite ce ticket."""
    key = ensure_issue(ctx, "R1", "En cours — COMP-01 (harnais)")
    ctx.jira.transition_to_category(key, "indeterminate")
    before = computed_at(read_dossier(ctx))
    dossier = trigger_recompute(ctx, before, "R1 recalcul")
    verdict = dossier["snapshot"]["verdict"]
    if verdict != "no-go":
        return CaseResult(ECHEC, f"avis attendu no-go, obtenu {verdict!r} (signaux : {signal_codes(dossier)}).")
    if not comp01_citing(dossier, key):
        return CaseResult(ECHEC, f"COMP-01 ne cite pas {key} (signaux : {signal_codes(dossier)}).")
    return CaseResult(OK, f"avis no-go, COMP-01 cite {key} (computedAt {before} → {computed_at(dossier)}).")


def case_r2(ctx):
    """§17.2 : incident ouvert → EXP-01. Non automatisable sans navigateur."""
    return CaseResult(SAUTE, (
        "EXP-01 exige un service rattaché au ticket : la carte composant → service "
        "s'écrit via l'écran de réglages (resolver screen.savePolicy), inaccessible "
        "sans navigateur ; le webtrigger est volontairement en lecture seule."
    ))


def case_r3(ctx):
    """§17.3 : dérogation 24 h → go sous conditions. Non automatisable sans navigateur."""
    return CaseResult(SAUTE, (
        "accorder une dérogation passe par l'action request-waiver avec un principal "
        "habilité (canWaive) — écran ou agent Rovo seulement ; aucune route d'écriture "
        "dans le webtrigger (lecture seule imposée)."
    ))


def case_r4(ctx):
    """§17.4 : preuve masquée selon le lecteur. Non automatisable."""
    return CaseResult(SAUTE, (
        "le masquage dépend de l'identité du lecteur (viewer.visibility) ; les appels "
        "webtrigger ne portent aucune identité utilisateur Atlassian (doc officielle : "
        "« Atlassian user information is not attached to invocations »)."
    ))


def case_r5(ctx):
    """§17.5 : projet sans dépôt relié → confiance basse et texte qui l'explique."""
    dossier = read_dossier(ctx)
    if dossier is None:
        dossier = trigger_recompute(ctx, None, "R5 premier calcul")
    snapshot = dossier["snapshot"]
    coverage = snapshot.get("coverage") or {}
    problems = []
    if snapshot.get("confidence") != "low":
        problems.append(f"confiance {snapshot.get('confidence')!r} ≠ low")
    if not coverage.get("issueCount"):
        problems.append("issueCount nul (version vide ?)")
    if coverage.get("issuesWithCode", 0) != 0:
        problems.append(f"issuesWithCode = {coverage.get('issuesWithCode')} ≠ 0 (un dépôt est relié)")
    if not coverage.get("notes"):
        problems.append("coverage.notes vide : le texte n'explique pas la donnée absente")
    if problems:
        return CaseResult(ECHEC, "; ".join(problems) + ".")
    return CaseResult(OK, (
        f"confiance low, couverture code {coverage.get('issuesWithCode')}/{coverage.get('issueCount')}, "
        f"{len(coverage['notes'])} note(s) de couverture l'expliquent."
    ))


def case_r6(ctx):
    """§17.6 : ticket bloquant « Terminé » → recalcul automatique en moins de 2 min."""
    key = ensure_issue(ctx, "R6", "Bloquant puis Terminé — recalcul auto (harnais)")
    ctx.jira.transition_to_category(key, "indeterminate")
    before = computed_at(read_dossier(ctx))
    dossier = trigger_recompute(ctx, before, "R6 précondition")
    if not comp01_citing(dossier, key):
        return CaseResult(ECHEC, f"précondition : COMP-01 absent pour {key} avant la transition.")
    baseline = computed_at(dossier)
    start = time.monotonic()
    ctx.jira.transition_to_category(key, "done")

    def cleared():
        fresh = read_dossier(ctx)
        stamp = computed_at(fresh)
        return fresh if stamp and stamp != baseline and not comp01_citing(fresh, key) else None

    try:
        poll_until(cleared, timeout=R6_POLL_SECONDS, interval=5, description="R6 recalcul automatique")
    except HarnessError as err:
        return CaseResult(ECHEC, str(err))
    elapsed = elapsed_since(start)
    if elapsed > R6_JUDGE_SECONDS:
        return CaseResult(ECHEC, f"recalcul automatique en {elapsed:.0f} s > {R6_JUDGE_SECONDS} s.")
    return CaseResult(OK, f"recalculé sans action manuelle en {elapsed:.0f} s (< 2 min), COMP-01 levé pour {key}.")


def cited_keys_of(entry):
    """Clés citées par la synthèse et clés présentes dans les signaux d'un snapshot."""
    narrative = (entry.get("snapshot") or {}).get("narrative") or ""
    signals_blob = json.dumps(entry.get("signals") or [])
    return set(KEY_RE.findall(narrative)), set(KEY_RE.findall(signals_blob))


def case_r8(ctx):
    """§17.8 : la synthèse ne cite aucun ticket absent des signaux (tous les dossiers sauvés)."""
    status, payload = ctx.webtrigger.snapshots(ctx.project_id)
    if status != 200 or not payload.get("ok"):
        raise HarnessError(f"webtrigger /snapshots -> {status} : {str(payload)[:200]}")
    entries = payload.get("snapshots") or []
    if not entries:
        return CaseResult(ECHEC, "aucun dossier sauvé pour ce projet : rien à vérifier.")
    violations = []
    legacy = 0
    checked = 0
    for entry in entries:
        cited, allowed = cited_keys_of(entry)
        # Dossiers antérieurs à la migration v003 : la table `signal` avait `id`
        # comme clé primaire, chaque recalcul écrasait l'historique. Aucun signal
        # n'est lisible pour eux — les compter à part plutôt que les faire passer
        # pour des violations (ou, pire, les ignorer en silence).
        if not allowed:
            legacy += 1
            continue
        checked += 1
        extra = sorted(cited - allowed)
        if extra:
            violations.append(f"{entry['snapshot'].get('versionName')}/{entry['snapshot']['id'][:8]}: {extra}")
    if violations:
        return CaseResult(ECHEC, "synthèse citant des tickets hors signaux : " + "; ".join(violations))
    if checked == 0:
        return CaseResult(ECHEC, f"aucun dossier vérifiable ({legacy} sans signaux enregistrés).")
    note = "" if checked >= 20 else f" (corpus {checked} < 20 : les 20 dossiers d'essai restent à constituer)"
    legacy_note = f", {legacy} antérieur(s) à la migration v003 non vérifiable(s)" if legacy else ""
    return CaseResult(OK, f"{checked} dossier(s) vérifié(s), aucune clé hors signaux{legacy_note}{note}.")


def case_r7(ctx):
    """§17.7 : l'agent répond comme l'écran. Non automatisable sans navigateur."""
    return CaseResult(SAUTE, (
        "interroger l'agent Rovo (« Peut-on livrer la 2.4 ? ») exige l'interface "
        "Rovo du site ; le harnais sans navigateur ne peut que comparer le dossier "
        "sauvé (webtrigger) à une réponse obtenue à la main."
    ))


#: Les 8 points du SPEC §17, dans l'ordre du SPEC.
CASES = [
    ("R1", "§17.1", case_r1),
    ("R2", "§17.2", case_r2),
    ("R3", "§17.3", case_r3),
    ("R4", "§17.4", case_r4),
    ("R5", "§17.5", case_r5),
    ("R6", "§17.6", case_r6),
    ("R7", "§17.7", case_r7),
    ("R8", "§17.8", case_r8),
]


def run_case(case_id, spec_ref, fn, ctx):
    """Exécute un cas sans jamais lever : un échec devient un CaseResult."""
    try:
        result = fn(ctx)
        result.spec_ref = spec_ref
        result.name = case_id
        return result
    except HarnessError as err:
        return _failed(case_id, spec_ref, str(err))
    except Exception as err:  # noqa: BLE001 — un cas échoué ne doit rien arrêter
        return _failed(case_id, spec_ref, f"erreur inattendue : {err!r}")


def _failed(case_id, spec_ref, reason):
    result = CaseResult(ECHEC, reason)
    result.name = case_id
    result.spec_ref = spec_ref
    return result
