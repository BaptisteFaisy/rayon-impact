#!/usr/bin/env python3
"""Garde automatisée des deux règles de taille du projet (docs/CONVENTIONS.md §1).

  * aucun fichier source ne dépasse ``MAX_FILE_LINES`` lignes ;
  * aucune fonction ne dépasse ``MAX_FUNCTION_LINES`` lignes.

Périmètre scanné : ``src/**``, ``tests/**`` (TypeScript / TSX) et
``scripts/**/*.py``. Bibliothèque standard uniquement : aucun réseau, aucune
dépendance, aucun fichier écrit — le script est idempotent et rejouable à
l'identique (il sert de garde en CI, cf. ``.github/workflows/ci.yml``).

Détection des fonctions :

  * TypeScript / TSX : ``^(export )?(async )?function <nom>`` et
    ``const <Nom> = (…) => {`` (composants React compris), longueur mesurée par
    équilibrage des accolades sur du code débarassé de ses commentaires et de
    ses littéraux de chaîne ;
  * Python : ``def`` / ``async def``, longueur mesurée par l'indentation.

Usage : ``python3 scripts/check-limits.py [racine] [--json] [-q]``
Codes de sortie : 0 = conforme, 1 = au moins un dépassement, 2 = erreur d'usage.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MAX_FILE_LINES = 500
MAX_FUNCTION_LINES = 50

# `scripts/**/*.py` seulement : les autres scripts (acceptance) sont déjà en Python.
SCANNED_ROOTS = ("src", "tests", "scripts")
CODE_SUFFIXES = {".ts", ".tsx", ".py"}
SCRIPTS_SUFFIXES = {".py"}
SKIPPED_DIRS = {".git", "node_modules", "dist", "build", "coverage",
                "__pycache__", ".forge", "static"}

TS_FUNCTION_RE = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*"
    r"([A-Za-z_$][\w$]*)")
TS_CONST_RE = re.compile(
    r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$")
TS_ARROW_IDENT_RE = re.compile(r"^[A-Za-z_$][\w$]*\s*=>")
PY_DEF_RE = re.compile(r"^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)")

ARROW_LOOKAHEAD = 12


def is_scanned(path: Path, root: Path) -> bool:
    """Vrai si le fichier entre dans le périmètre des deux règles."""
    try:
        relative = path.relative_to(root)
    except ValueError:
        return False
    parts = relative.parts
    if not parts or parts[0] not in SCANNED_ROOTS:
        return False
    if any(part in SKIPPED_DIRS for part in parts):
        return False
    if parts[0] == "scripts":
        return path.suffix in SCRIPTS_SUFFIXES
    return path.suffix in CODE_SUFFIXES


def iter_source_files(root: Path):
    """Fichiers source du périmètre, triés pour une sortie stable."""
    for path in sorted(root.rglob("*")):
        if path.is_file() and is_scanned(path, root):
            yield path


def read_lines(path: Path):
    """Lignes du fichier, ou None s'il n'est pas du texte UTF-8 (binaire)."""
    try:
        return path.read_text(encoding="utf-8").splitlines()
    except (UnicodeDecodeError, OSError):
        return None


def code_only(line: str, state: dict) -> str:
    """Retire commentaires et littéraux de chaîne ; `state` suit les blocs."""
    out = []
    i = 0
    n = len(line)
    while i < n:
        char = line[i]
        nxt = line[i + 1] if i + 1 < n else ""
        if state["block"]:
            if char == "*" and nxt == "/":
                state["block"] = False
                i += 2
            else:
                i += 1
            continue
        if state["template"]:
            if char == "\\":
                i += 2
            elif char == "`":
                state["template"] = False
                i += 1
            else:
                i += 1
            continue
        if char == "/" and nxt == "/":
            break
        if char == "/" and nxt == "*":
            state["block"] = True
            i += 2
            continue
        if char in ("'", '"'):
            i = skip_quoted(line, i, char)
            continue
        if char == "`":
            state["template"] = True
            i += 1
            continue
        out.append(char)
        i += 1
    return "".join(out)


def skip_quoted(line: str, start: int, quote: str) -> int:
    """Index suivant la fin d'un littéral ouvert en `start` (ou fin de ligne)."""
    i = start + 1
    n = len(line)
    while i < n:
        if line[i] == "\\":
            i += 2
            continue
        if line[i] == quote:
            return i + 1
        i += 1
    return n


def stripped_lines(lines: list[str]) -> list[str]:
    """Code seul, ligne à ligne, état des commentaires propagé sur le fichier."""
    state = {"block": False, "template": False}
    return [code_only(line, state) for line in lines]


def brace_end(stripped: list[str], start: int, column: int = 0):
    """Fin (ligne, indice) du bloc ouvert par la première accolade ≥ `column`.

    Renvoie None si aucune accolade ouvrante n'est trouvée (déclaration sans
    corps, par exemple `declare function`).
    """
    depth = 0
    opened = False
    for index in range(start, len(stripped)):
        text = stripped[index]
        first = column if index == start else 0
        for position in range(first, len(text)):
            char = text[position]
            if char == "{":
                depth += 1
                opened = True
            elif char == "}":
                depth -= 1
                if opened and depth == 0:
                    return index, position
    return None


def arrow_body(stripped: list[str], index: int, rest: str):
    """Corps d'une fonction fléchée / expression de fonction affectée à une constante.

    Renvoie (ligne, colonne) de l'accolade ouvrante du corps, ou None si la
    valeur affectée n'est pas une fonction (objet, tableau, annotation de type).
    """
    text = rest.strip()
    if text.startswith("async"):
        text = text[len("async"):].lstrip()
    if text.startswith("function"):
        return ts_body_start(stripped, index, len(stripped[index]) - len(text))
    ident = TS_ARROW_IDENT_RE.match(text)
    if ident:
        offset = len(stripped[index]) - len(text) + ident.end()
        return body_after_arrow(stripped, index, offset)
    if text.startswith("("):
        return after_params(stripped, index, text)
    return None


def ts_body_start(stripped: list[str], index: int, column: int):
    """Accolade du corps d'une `function` : après la fermeture des paramètres.

    Une déstructuration dans la liste (`function f({ a }) {`) referme sinon la
    profondeur d'accolades dès la signature.
    """
    close = params_close(stripped, index, column)
    if close is None:
        return first_brace_from(stripped, index, column)
    return first_brace_from(stripped, close[0], close[1] + 1)


def params_close(stripped: list[str], index: int, column: int):
    """Position de la parenthèse fermant la liste de paramètres, ou None."""
    depth = 0
    opened = False
    for line_no in range(index, min(len(stripped), index + ARROW_LOOKAHEAD)):
        text = stripped[line_no]
        start = column if line_no == index else 0
        for position in range(start, len(text)):
            char = text[position]
            if char == "(":
                depth += 1
                opened = True
            elif char == ")":
                depth -= 1
                if opened and depth == 0:
                    return line_no, position
            elif char == "{" and not opened:
                return None
    return None


def first_brace_from(stripped: list[str], line_no: int, column: int):
    """Première accolade ouvrante à partir de (ligne, colonne), ou None."""
    for scan in range(line_no, min(len(stripped), line_no + ARROW_LOOKAHEAD)):
        text = stripped[scan]
        start = column if scan == line_no else 0
        position = text.find("{", start)
        if position >= 0:
            return scan, position
        if text[start:].strip().endswith(";"):
            return None
    return None


def body_after_arrow(stripped: list[str], line_no: int, column: int):
    """Accolade du corps juste après `=>` (corps expression : pas de bloc)."""
    text = stripped[line_no]
    position = text.find("{", column)
    if position >= 0:
        return line_no, position
    suivante = line_no + 1
    if suivante < len(stripped) and stripped[suivante].lstrip().startswith("{"):
        return suivante, stripped[suivante].index("{")
    return None


def after_params(stripped: list[str], index: int, text: str):
    """Flèche dont la liste de paramètres commence en `(` (multi-lignes admise)."""
    close = params_close(stripped, index, len(stripped[index]) - len(text))
    if close is None:
        return None
    for scan in range(close[0], min(len(stripped), close[0] + ARROW_LOOKAHEAD)):
        ligne = stripped[scan]
        colonne = close[1] + 1 if scan == close[0] else 0
        arrow = ligne.find("=>", colonne)
        if arrow >= 0:
            return body_after_arrow(stripped, scan, arrow + 2)
        if ligne[colonne:].strip().endswith(";"):
            return None
    return None


def ts_spans(stripped: list[str]) -> list[tuple[int, int, str]]:
    """Intervalles (début, fin, nom) des fonctions TypeScript, en lignes 1-based."""
    spans: list[tuple[int, int, str]] = []
    index = 0
    while index < len(stripped):
        line = stripped[index]
        match = TS_FUNCTION_RE.match(line)
        if match:
            body = ts_body_start(stripped, index, match.end())
            end = None if body is None else brace_end(stripped, body[0], body[1])
            if end is not None:
                spans.append((index + 1, end[0] + 1, match.group(1)))
                index = end[0] + 1
                continue
        const = TS_CONST_RE.match(line)
        if const:
            body = arrow_body(stripped, index, const.group(2))
            if body is not None:
                end = brace_end(stripped, body[0], body[1])
                if end is not None:
                    spans.append((index + 1, end[0] + 1, const.group(1)))
                    index = end[0] + 1
                    continue
        index += 1
    return spans


def python_end(lines: list[str], start: int, indent: int) -> int:
    """Dernière ligne du corps d'un `def` : première ligne moins indentée."""
    last = start
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        current = len(line) - len(line.lstrip())
        if current <= indent:
            break
        last = index
    return last


def py_spans(lines: list[str]) -> list[tuple[int, int, str]]:
    """Intervalles (début, fin, nom) des fonctions Python, en lignes 1-based."""
    spans: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        match = PY_DEF_RE.match(line)
        if not match:
            continue
        indent = len(match.group(1))
        end = python_end(lines, index, indent)
        spans.append((index + 1, end + 1, match.group(2)))
    return spans


def function_spans(lines: list[str], suffix: str) -> list[tuple[int, int, str]]:
    if suffix == ".py":
        return py_spans(lines)
    return ts_spans(stripped_lines(lines))


def check_file(path: Path, root: Path) -> list[dict]:
    """Dépassements d'un fichier : taille du fichier puis taille des fonctions."""
    lines = read_lines(path)
    if lines is None:
        return []
    relative = path.relative_to(root).as_posix()
    problems = []
    if len(lines) >= MAX_FILE_LINES:
        problems.append(violation(relative, "file", 1, path.stem, len(lines),
                                  MAX_FILE_LINES))
    for start, end, name in function_spans(lines, path.suffix):
        length = end - start + 1
        if length >= MAX_FUNCTION_LINES:
            problems.append(violation(relative, "function", start, name, length,
                                      MAX_FUNCTION_LINES))
    return problems


def violation(file: str, kind: str, line: int, name: str, size: int,
              limit: int) -> dict:
    return {"file": file, "kind": kind, "line": line, "name": name,
            "lines": size, "limit": limit}


def check_root(root: Path) -> dict:
    """Résultat complet du contrôle d'un arbre."""
    problems: list[dict] = []
    scanned = 0
    skipped_binary = 0
    for path in iter_source_files(root):
        if read_lines(path) is None:
            skipped_binary += 1
            continue
        scanned += 1
        problems.extend(check_file(path, root))
    return {"ok": not problems, "root": root.as_posix(), "files_scanned": scanned,
            "files_skipped_binary": skipped_binary,
            "max_file_lines": MAX_FILE_LINES,
            "max_function_lines": MAX_FUNCTION_LINES, "violations": problems}


def render_text(result: dict) -> str:
    lines = []
    for item in result["violations"]:
        if item["kind"] == "file":
            lines.append("KO %s : fichier de %d lignes (maximum %d)"
                         % (item["file"], item["lines"], item["limit"]))
        else:
            lines.append("KO %s:%d : fonction %s de %d lignes (maximum %d)"
                         % (item["file"], item["line"], item["name"],
                            item["lines"], item["limit"]))
    if lines:
        lines.append("")
        lines.append("%d depassement(s) des regles de taille."
                     % len(result["violations"]))
        return "\n".join(lines)
    return ("OK — %d fichier(s) controles : tous sous %d lignes, "
            "toutes les fonctions sous %d lignes."
            % (result["files_scanned"], result["max_file_lines"],
               result["max_function_lines"]))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Garde des regles de taille : fichiers < %d lignes, "
                    "fonctions < %d lignes." % (MAX_FILE_LINES, MAX_FUNCTION_LINES))
    parser.add_argument("root", nargs="?", default=".",
                        help="racine du depot (defaut : repertoire courant)")
    parser.add_argument("--json", action="store_true",
                        help="sortie JSON machine (une seule ligne)")
    parser.add_argument("-q", "--quiet", action="store_true",
                        help="n'afficher que les depassements")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        print("erreur : racine introuvable : %s" % root, file=sys.stderr)
        return 2
    result = check_root(root)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    elif result["violations"] or not args.quiet:
        print(render_text(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
