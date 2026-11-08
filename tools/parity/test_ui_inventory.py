import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("ui_inventory", Path(__file__).with_name("ui_inventory.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.put("objects/core/window/w_base.json", {
            "name": "w_base", "ancestor": "window", "kind": "window",
            "controls": [{"name": "tabs", "ancestor": "tab", "controls": [
                {"name": "detail", "ancestor": "datawindow", "fields": [
                    {"name": "dataobject", "value": "d_present"},
                    {"name": "visible", "value": True},
                    {"name": "text", "value": "DO_NOT_EMIT"},
                ]},
            ]}],
        })
        self.put("objects/core/window/w_child.json", {
            "name": "w_child", "ancestor": "w_base", "kind": "window",
            "controls": [{"name": "tabs", "ancestor": "tabs", "controls": [
                {"name": "detail", "ancestor": "detail", "fields": [
                    {"name": "visible", "value": False},
                ]},
            ]}],
        })
        self.put("dw/core.json.gz", {"d_present": {
            "datawindow": {"processing": "1"}, "table": {
                "retrieve": "DO_NOT_EMIT", "columns": [{"name": "amount", "type": "decimal(2)", "initial": "DO_NOT_EMIT"}],
            }, "objects": [{"type": "report", "name": "child", "band": "detail", "dataobject": "d_missing"}],
        }})
        self.put("dw/_index.json", {"d_present": "core"})
        self.put("menu_trees/core/m_main.json", {"name": "m_main", "items": [
            {"name": "m_file", "items": [{"name": "m_save", "items": []}]},
        ]})

    def put(self, path, value):
        target = self.root / "data" / "src" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        data = json.dumps(value).encode("utf-8")
        target.write_bytes(gzip.compress(data, mtime=0) if target.suffix == ".gz" else data)

    def test_inheritance_preserves_siblings_and_false_overrides(self):
        result = module.inventory(self.root)
        child = next(w for w in result["windows"] if w["id"] == "w_child")
        detail = next(c for c in child["controls"] if c["path"] == "tabs.detail")
        self.assertIs(detail["initialVisibility"], False)
        self.assertEqual(detail["datawindow"], "d_present")
        base = next(w for w in result["windows"] if w["id"] == "w_base")
        self.assertIs(base["controls"][1]["initialVisibility"], True)

    def test_no_values_or_false_completion_claims(self):
        result = module.inventory(self.root)
        self.assertNotIn("DO_NOT_EMIT", json.dumps(result))
        self.assertEqual(result["counts"]["modernVerified"], 0)
        self.assertEqual(result["datawindows"][0]["documentUse"], "unclassified")
        self.assertEqual(result["datawindows"][0]["staticUse"], {"visibleControls": 1, "hiddenControls": 1, "nestedInReports": 0})
        self.assertEqual(result["counts"]["datawindowsOnVisibleControls"], 1)
        self.assertEqual(result["counts"]["datawindowsOnlyOnHiddenControls"], 0)
        self.assertEqual(result["missingStaticDatawindows"], ["d_missing"])
        self.assertEqual(result["menus"][0]["items"][1]["id"], "m_main.m_file.m_save")
        self.assertEqual(result["counts"]["datawindowColumns"], 1)

    def test_deterministic_digest_and_output(self):
        self.assertEqual(module.inventory(self.root), module.inventory(self.root))

    def test_duplicate_classes_fail_explicitly(self):
        self.put("objects/other/window/w_child.json", {"name": "w_child", "kind": "window"})
        with self.assertRaisesRegex(ValueError, "Ambiguous duplicate class"):
            module.inventory(self.root)

    def test_inheritance_cycles_fail(self):
        self.put("objects/core/window/w_base.json", {"name": "w_base", "kind": "window", "ancestor": "w_child"})
        with self.assertRaisesRegex(ValueError, "Inheritance cycle"):
            module.inventory(self.root)

    def test_missing_bundles_fail(self):
        (self.root / "data" / "src" / "dw" / "core.json.gz").unlink()
        with self.assertRaisesRegex(ValueError, "No DataWindow bundles"):
            module.inventory(self.root)

    def test_runtime_index_selects_the_authoritative_bundle(self):
        self.put("dw/other.json.gz", {"d_present": {
            "datawindow": {"processing": "2"}, "table": {}, "objects": [],
        }})
        result = module.inventory(self.root)
        self.assertEqual(result["datawindows"][0]["library"], "core")
        self.assertEqual(result["datawindows"][0]["processing"], "grid")
        self.assertEqual(result["counts"]["shadowedDefinitions"], 1)

    def test_indexed_but_unavailable_definitions_remain_visible(self):
        self.put("dw/_index.json", {"d_present": "core", "d_unavailable": "missing"})
        result = module.inventory(self.root)
        self.assertEqual(result["missingIndexedDatawindows"], ["d_unavailable"])
        self.assertEqual(result["counts"]["missingIndexedDatawindows"], 1)

    def test_corrupt_json_is_not_silently_skipped(self):
        (self.root / "data" / "src" / "objects" / "broken.json").write_text("{", encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            module.inventory(self.root)


if __name__ == "__main__":
    unittest.main()
