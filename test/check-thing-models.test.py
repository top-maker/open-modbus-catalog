# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "modpoll-wot==0.7.0a4",
#     "pyyaml==6.0.3",
# ]
#
# [tool.uv]
# prerelease = "allow"
# ///
"""Each static check rejects the bad Thing Model or data it exists for.

Run: uv run --locked --script test/check-thing-models.test.py
"""

import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("check_thing_models", SCRIPTS / "check-thing-models.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def point(address, kind="xsd:unsignedShort", quantity=1, schema="integer", **form):
    return {
        "type": schema,
        "readOnly": True,
        "forms": [{"op": "readproperty", "contentType": "application/octet-stream",
                   "modv:entity": "HoldingRegister", "modv:address": address,
                   "modv:quantity": quantity, "modv:type": kind, **form}],
    }


def model(**properties):
    return {
        "@context": ["https://www.w3.org/2022/wot/td/v1.1",
                     {"modpoll": "https://top-maker.github.io/modpoll/vocab/wot-modbus#",
                      "modv": "https://www.w3.org/2019/wot/modbus",
                      "xsd": "http://www.w3.org/2001/XMLSchema#"}],
        "@type": "tm:ThingModel",
        "title": "Test",
        "modpoll:version": "0.2",
        "properties": properties,
        "modpoll:acquisition": [{"modv:entity": "HoldingRegister", "modv:address": 0, "modv:quantity": 8,
                                 "modpoll:members": list(properties)}],
    }


def data(**initial):
    return {"version": "1", "initial": initial}


class Overlaps(unittest.TestCase):
    def test_separate_points_pass(self):
        self.assertEqual(checks.check_overlaps(model(a=point(0), b=point(1, "xsd:unsignedInt", 2))), [])

    def test_a_point_inside_another_fails(self):
        problems = checks.check_overlaps(model(a=point(0, "xsd:unsignedInt", 2), b=point(1)))
        self.assertEqual(problems, ["a and b overlap at HoldingRegister 1"])

    def test_identical_aliases_pass(self):
        self.assertEqual(checks.check_overlaps(model(a=point(0), b=point(0))), [])

    def test_aliases_that_decode_differently_fail(self):
        self.assertTrue(checks.check_overlaps(model(a=point(0), b=point(0, "xsd:short"))))

    def test_different_bits_of_one_register_pass(self):
        bits = model(a=point(0, "xsd:boolean", schema="boolean", **{"modpoll:bit": 0}),
                     b=point(0, "xsd:boolean", schema="boolean", **{"modpoll:bit": 1}))
        self.assertEqual(checks.check_overlaps(bits), [])


class Ranges(unittest.TestCase):
    def test_a_range_within_the_raw_type_passes(self):
        self.assertEqual(checks.check_ranges(model(a=point(0) | {"minimum": 0, "maximum": 65535})), [])

    def test_a_maximum_beyond_the_raw_type_fails(self):
        self.assertTrue(checks.check_ranges(model(a=point(0) | {"maximum": 65536})))

    def test_the_multiplier_scales_the_raw_range(self):
        scaled = point(0, schema="number", **{"modpoll:multiplier": "0.1"})
        self.assertEqual(checks.check_ranges(model(a=scaled | {"maximum": 6553.5})), [])
        self.assertTrue(checks.check_ranges(model(a=scaled | {"maximum": 6553.6})))

    def test_a_negative_minimum_of_an_unsigned_point_fails(self):
        self.assertTrue(checks.check_ranges(model(a=point(0) | {"minimum": -1})))

    def test_a_minimum_above_the_maximum_fails(self):
        self.assertTrue(checks.check_ranges(model(a=point(0) | {"minimum": 5, "maximum": 4})))


class Data(unittest.TestCase):
    thing_model = model(
        count=point(0) | {"maximum": 1000},
        scaled=point(1, schema="number", **{"modpoll:multiplier": "0.1"}),
        flag=point(2, "xsd:boolean", schema="boolean", **{"modpoll:bit": 0}),
        name=point(3, "xsd:string", 2, schema="string"),
        level=point(5, "xsd:float", 2, schema="number") | {"minimum": 0, "maximum": 100},
    )
    good = dict(count=7, scaled=230.1, flag=True, name="SIM", level=12.5)

    def problems(self, document):
        return checks.check_data(self.thing_model, document)

    def test_values_that_fit_pass(self):
        self.assertEqual(self.problems(data(**self.good)), [])

    def test_a_value_above_the_maximum_fails(self):
        self.assertTrue(self.problems(data(**self.good | {"count": 1001})))

    def test_a_scaled_value_between_raw_steps_fails(self):
        self.assertTrue(self.problems(data(**self.good | {"scaled": 230.15})))

    def test_a_scaled_value_beyond_the_raw_type_fails(self):
        self.assertTrue(self.problems(data(**self.good | {"scaled": 6553.6})))

    def test_a_fraction_for_an_integer_fails(self):
        self.assertTrue(self.problems(data(**self.good | {"count": 1.5})))

    def test_a_wrong_type_fails(self):
        self.assertTrue(self.problems(data(**self.good | {"flag": 1})))

    def test_a_string_beyond_its_registers_fails(self):
        self.assertTrue(self.problems(data(**self.good | {"name": "TOOLONG"})))

    def test_a_missing_point_fails(self):
        initial = dict(self.good)
        del initial["level"]
        self.assertEqual(self.problems(data(**initial)), ["no simulation value for level"])

    def test_a_generator_beyond_the_range_fails(self):
        document = data(**self.good)
        document["generators"] = {"level": {"kind": "sine", "center": 90, "amplitude": 20, "period": 60}}
        self.assertEqual(len(self.problems(document)), 1)

    def test_a_generator_within_the_range_passes(self):
        document = data(**self.good)
        document["generators"] = {"level": {"kind": "ramp", "start": 0, "rate": 1, "minimum": 0, "maximum": 100}}
        self.assertEqual(self.problems(document), [])

    def test_an_identity_point_must_serve_its_constant(self):
        thing_model = model(version=point(0) | {"const": 3})
        self.assertTrue(checks.check_data(thing_model, data(version=4)))


class Package(unittest.TestCase):
    def check(self, thing_model, document):
        with TemporaryDirectory() as directory:
            package = Path(directory)
            (package / "model.tm.json").write_text(json.dumps(thing_model))
            (package / "model.data.json").write_text(json.dumps(document))
            return checks.check(package, presets={})

    def test_a_good_package_passes(self):
        self.assertEqual(self.check(model(a=point(0)), data(a=1)), "model.data.json")

    def test_a_profile_violation_fails(self):
        broken = model(a=point(0, "xsd:unsignedInt", 1))  # a 32-bit type in one register
        with self.assertRaises(ValueError):
            self.check(broken, data(a=1))

    def test_a_consistency_problem_fails(self):
        overlapping = model(a=point(0, "xsd:unsignedInt", 2), b=point(1))
        with self.assertRaisesRegex(checks.CheckError, "overlap"):
            self.check(overlapping, data(a=1, b=1))

    def test_data_for_an_unknown_point_fails(self):
        with self.assertRaises(ValueError):
            self.check(model(a=point(0)), data(a=1, b=2))


if __name__ == "__main__":
    unittest.main()
