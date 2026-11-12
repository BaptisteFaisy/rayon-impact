"""Auto-test de `scripts/check-limits.py` — la garde des règles de taille.

Lancement : `python3 -m unittest discover tests/scripts` (stdlib `unittest`,
aucun pytest requis). Chaque cas écrit de vrais fichiers dans un arbre
temporaire puis interroge la garde : aucun fixture partagé, aucune E/S hors
temporaire.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest

RACINE = pathlib.Path(__file__).resolve().parents[2]
GARDE = RACINE / "scripts" / "check-limits.py"


def charger_garde():
    spec = importlib.util.spec_from_file_location("check_limits", GARDE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


garde = charger_garde()


def ecrire(racine: pathlib.Path, relatif: str, contenu: str) -> pathlib.Path:
    chemin = racine / relatif
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(contenu, encoding="utf-8")
    return chemin


def fonction_ts(nom: str, lignes: int) -> str:
    """Une fonction TypeScript de exactement `lignes` lignes (accolades comprises)."""
    corps = "\n".join("  const x%d = %d;" % (i, i) for i in range(max(lignes - 2, 0)))
    texte = "export function %s() {\n%s\n}\n" % (nom, corps)
    assert len(texte.splitlines()) == lignes, len(texte.splitlines())
    return texte


def fonction_py(nom: str, lignes: int) -> str:
    """Une fonction Python de exactement `lignes` lignes (`def` compris)."""
    corps = "\n".join("    x%d = %d" % (i, i) for i in range(max(lignes - 3, 0)))
    texte = "def %s():\n    pass\n%s\n    return None\n" % (nom, corps)
    assert len(texte.splitlines()) == lignes, len(texte.splitlines())
    return texte


class CasConformes(unittest.TestCase):
    def test_arbre_conforme_aucun_depassement(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/moteur.ts", fonction_ts("calculer", 49))
            ecrire(racine, "tests/moteur.test.ts", fonction_ts("tester", 12))
            ecrire(racine, "scripts/outil.py", fonction_py("main", 49))
            resultat = garde.check_root(racine)
        self.assertTrue(resultat["ok"], resultat["violations"])
        self.assertEqual([], resultat["violations"])
        self.assertEqual(3, resultat["files_scanned"])

    def test_limite_fonction_strictement_inferieure(self):
        """49 lignes passent, 50 lignes tombent : la règle est « < 50 »."""
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/ok.ts", fonction_ts("ok", 49))
            ecrire(racine, "src/ko.ts", fonction_ts("ko", 50))
            resultat = garde.check_root(racine)
        noms = [v["name"] for v in resultat["violations"]]
        self.assertEqual(["ko"], noms)
        self.assertEqual(50, resultat["violations"][0]["lines"])
        self.assertEqual("function", resultat["violations"][0]["kind"])

    def test_fichier_vide_considere_conforme(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/vide.ts", "")
            resultat = garde.check_root(racine)
        self.assertTrue(resultat["ok"])
        self.assertEqual(1, resultat["files_scanned"])
        self.assertEqual(0, resultat["files_skipped_binary"])

    def test_idempotent_deux_passages_identiques(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/a.ts", fonction_ts("a", 60))
            premier = garde.check_root(racine)
            second = garde.check_root(racine)
        self.assertEqual(premier, second)


class Depassements(unittest.TestCase):
    def test_fichier_trop_long(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/long.ts", "\n".join("// ligne %d" % i for i in range(520)))
            resultat = garde.check_root(racine)
        self.assertFalse(resultat["ok"])
        seul = resultat["violations"][0]
        self.assertEqual("file", seul["kind"])
        self.assertEqual("src/long.ts", seul["file"])
        self.assertEqual(520, seul["lines"])
        self.assertEqual(500, seul["limit"])

    def test_fonction_ts_trop_longue(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/gros.ts", fonction_ts("grosTraitement", 74))
            resultat = garde.check_root(racine)
        seul = resultat["violations"][0]
        self.assertEqual(("function", "grosTraitement", 74, 1),
                         (seul["kind"], seul["name"], seul["lines"], seul["line"]))

    def test_fonction_python_trop_longue(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "scripts/long.py", fonction_py("derouler", 61))
            resultat = garde.check_root(racine)
        seul = resultat["violations"][0]
        self.assertEqual(("function", "derouler", 61), (seul["kind"], seul["name"], seul["lines"]))

    def test_binaire_ignoré_sans_plantage(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            chemin = racine / "src" / "donnees.ts"
            chemin.parent.mkdir(parents=True)
            chemin.write_bytes(b"\xff\xfe\x00\x01octet-invalide-utf8\x80\x81")
            ecrire(racine, "src/sain.ts", fonction_ts("sain", 10))
            resultat = garde.check_root(racine)
        self.assertTrue(resultat["ok"])
        self.assertEqual(1, resultat["files_skipped_binary"])
        self.assertEqual(1, resultat["files_scanned"])


class DetectionTypeScript(unittest.TestCase):
    def test_composant_react_declaration(self):
        source = (
            "import { View, Text } from '@forge/react';\n"
            "\n"
            "export function DossierHeader({ titre }: { titre: string }) {\n"
            "  return (\n"
            "    <View>\n"
            "      <Text>{titre}</Text>\n"
            "    </View>\n"
            "  );\n"
            "}\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            ecrire(pathlib.Path(tmp), "src/ui/header.tsx", source)
            resultat = garde.check_root(pathlib.Path(tmp))
        self.assertTrue(resultat["ok"], resultat["violations"])
        spans = garde.ts_spans(garde.stripped_lines(source.splitlines()))
        self.assertEqual([(3, 9, "DossierHeader")], spans)

    def test_composant_react_fleche_et_accolades_dans_les_chaines(self):
        source = (
            "export const Panneau = ({ texte }: { texte: string }) => {\n"
            "  const modele = '{ pas une accolade de bloc }';\n"
            "  // commentaire avec } une accolade fermante\n"
            "  return <div title=\"}\">{modele}</div>;\n"
            "};\n"
        )
        spans = garde.ts_spans(garde.stripped_lines(source.splitlines()))
        self.assertEqual([(1, 5, "Panneau")], spans)

    def test_fonction_async_exportee(self):
        source = ("export async function recalculer(deps: Deps): Promise<void> {\n"
                  "  await deps.queue.publish({ versionId: '1' });\n"
                  "}\n")
        spans = garde.ts_spans(garde.stripped_lines(source.splitlines()))
        self.assertEqual([(1, 3, "recalculer")], spans)

    def test_litteral_objet_type_avec_fleche_non_confondu(self):
        """`Record<string, (a) => b> = { … }` n'est pas une fonction."""
        bloc = "\n".join("  cle%d: () => %d," % (i, i) for i in range(80))
        source = ("export const ECRANS: Record<string, (p: Payload) => Promise<unknown>> = {\n"
                  + bloc + "\n};\n")
        spans = garde.ts_spans(garde.stripped_lines(source.splitlines()))
        self.assertEqual([], [s for s in spans if s[2] == "ECRANS"])

    def test_accolades_dans_commentaire_bloc_et_gabarit(self):
        source = ("function outil() {\n"
                  "  /* } { */\n"
                  "  const sql = `SELECT * FROM signal WHERE id = ${x} } {`;\n"
                  "  return sql;\n"
                  "}\n")
        spans = garde.ts_spans(garde.stripped_lines(source.splitlines()))
        self.assertEqual([(1, 5, "outil")], spans)


class DetectionPython(unittest.TestCase):
    def test_def_et_indentation(self):
        source = ("def dehors():\n"
                  "    def dedans():\n"
                  "        return 1\n"
                  "    return dedans()\n"
                  "\n"
                  "\n"
                  "class Chose:\n"
                  "    def methode(self):\n"
                  "        return 2\n")
        spans = garde.py_spans(source.splitlines())
        self.assertEqual([(1, 4, "dehors"), (2, 3, "dedans"), (8, 9, "methode")], spans)

    def test_async_def_et_lignes_vides_commentaires(self):
        source = ("async def collecter():\n"
                  "    # un commentaire\n"
                  "\n"
                  "    return []\n"
                  "\n"
                  "\n"
                  "def suivant():\n"
                  "    return None\n")
        spans = garde.py_spans(source.splitlines())
        self.assertEqual([(1, 4, "collecter"), (7, 8, "suivant")], spans)


class PerimetreEtSorties(unittest.TestCase):
    def test_perimetre_src_tests_scripts_py(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            long_ts = "\n".join("// %d" % i for i in range(600))
            long_py = "\n".join("# %d" % i for i in range(600))
            ecrire(racine, "src/a.ts", long_ts)
            ecrire(racine, "tests/b.ts", long_ts)
            ecrire(racine, "scripts/c.py", long_py)
            ecrire(racine, "scripts/d.ts", long_ts)          # hors périmètre
            ecrire(racine, "docs/e.ts", long_ts)             # hors périmètre
            ecrire(racine, "node_modules/f.ts", long_ts)     # ignoré
            resultat = garde.check_root(racine)
        fichiers = sorted(v["file"] for v in resultat["violations"])
        self.assertEqual(["scripts/c.py", "src/a.ts", "tests/b.ts"], fichiers)
        self.assertEqual(3, resultat["files_scanned"])

    def test_garde_sur_elle_meme(self):
        """La garde respecte ses propres règles (fichier et fonctions)."""
        lignes = garde.read_lines(GARDE)
        self.assertLess(len(lignes), garde.MAX_FILE_LINES)
        for debut, fin, nom in garde.function_spans(lignes, GARDE.suffix):
            self.assertLess(fin - debut + 1, garde.MAX_FUNCTION_LINES, nom)

    def test_sortie_json_et_code_de_sortie(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/ko.ts", fonction_ts("ko", 55))
            tampon = io.StringIO()
            with contextlib.redirect_stdout(tampon):
                code = garde.main([str(racine), "--json"])
            donnees = json.loads(tampon.getvalue())
        self.assertEqual(1, code)
        self.assertFalse(donnees["ok"])
        self.assertEqual("ko", donnees["violations"][0]["name"])

    def test_codes_de_sortie_conforme_et_erreur(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/ok.ts", fonction_ts("ok", 8))
            tampon = io.StringIO()
            with contextlib.redirect_stdout(tampon):
                code_ok = garde.main([str(racine)])
                sortie = tampon.getvalue()
            with contextlib.redirect_stdout(io.StringIO()):
                code_ko = garde.main([str(racine / "absent")])
        self.assertEqual(0, code_ok)
        self.assertIn("OK", sortie)
        self.assertEqual(2, code_ko)

    def test_lecture_texte_sortie_lisible(self):
        with tempfile.TemporaryDirectory() as tmp:
            racine = pathlib.Path(tmp)
            ecrire(racine, "src/ko.ts", fonction_ts("tropLongue", 60))
            texte = garde.render_text(garde.check_root(racine))
        self.assertIn("src/ko.ts:1", texte)
        self.assertIn("tropLongue", texte)
        self.assertIn("60 lignes", texte)
        self.assertIn("maximum 50", texte)
        self.assertIn("1 depassement(s)", texte)


if __name__ == "__main__":
    unittest.main()
