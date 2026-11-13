# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml==6.0.3"]
# ///
"""Simulation values for catalog Thing Models.

`preset_data` builds static simulation data (initial values only) from
simulation-presets.yaml for a package without model.data.json. `edge_values`
builds the decoding passes of the simulation check from point types alone.
Scaled values are the raw integer times the multiplier as Modpoll computes it,
which Modsim serves exactly and Modpoll reads back unchanged.

Run it on a package to print the preset simulation data, for example to start
a model.data.json:

    uv run scripts/simulation.py <package directory>
"""

import json
import math
import struct
import sys
from fractions import Fraction
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]

INTEGER_RANGES = {
    "xsd:unsignedShort": (0, 2**16 - 1), "xsd:short": (-(2**15), 2**15 - 1),
    "xsd:unsignedInt": (0, 2**32 - 1), "xsd:int": (-(2**31), 2**31 - 1),
    "xsd:unsignedLong": (0, 2**64 - 1), "xsd:long": (-(2**63), 2**63 - 1),
}
FLOATS = {"xsd:float": "f", "xsd:double": "d"}


def read_form(prop):
    def ops(form):
        op = form.get("op", "readproperty")
        return [op] if isinstance(op, str) else op
    return next((form for form in prop["forms"] if "readproperty" in ops(form)), prop["forms"][0])


def bounds(prop, form):
    """Raw integer bounds, narrowed by the property's minimum and maximum."""
    low, high = INTEGER_RANGES[form["modv:type"]]
    factor = Fraction(form.get("modpoll:multiplier", "1"))
    if factor:
        if "minimum" in prop:
            low = max(low, math.ceil(Fraction(str(prop["minimum"])) / factor))
        if "maximum" in prop:
            high = min(high, math.floor(Fraction(str(prop["maximum"])) / factor))
    return low, high, factor


def scaled(raw, factor):
    """The value Modpoll reads for raw: float(raw) * float(multiplier)."""
    return raw if factor == 1 else float(raw) * float(factor)


def fit(prop, target):
    """The value closest to target that the point can serve exactly, or None."""
    form = read_form(prop)
    kind = form["modv:type"]
    if prop["type"] == "boolean" or kind == "xsd:boolean":
        return bool(target)
    if prop["type"] == "string" or kind == "xsd:string":
        return str(target)
    if kind in FLOATS:
        value = float(target)
        if "minimum" in prop:
            value = max(value, prop["minimum"])
        if "maximum" in prop:
            value = min(value, prop["maximum"])
        code = FLOATS[kind]
        return struct.unpack(code, struct.pack(code, value))[0]
    low, high, factor = bounds(prop, form)
    if low > high:
        return None
    raw = min(max(round(Fraction(str(target)) / factor) if factor else 0, low), high)
    return scaled(raw, factor)


def load_presets():
    return yaml.safe_load((ROOT / "simulation-presets.yaml").read_text(encoding="utf-8"))


def preset_value(name, prop, rules):
    for rule in rules:
        if "unit" in rule and rule["unit"] != prop.get("unit"):
            continue
        if "type" in rule and rule["type"] != prop["type"]:
            continue
        if "name" in rule and rule["name"].lower() not in name.lower():
            continue
        return rule["value"]
    raise ValueError(f"{name}: no simulation preset matches type {prop['type']}")


def preset_data(thing_model, category, presets=None):
    presets = presets or load_presets()
    rules = presets.get(category, []) + presets["default"]
    initial = {}
    for name, prop in thing_model["properties"].items():
        value = fit(prop, preset_value(name, prop, rules))
        if value is None:
            raise ValueError(f"{name}: no exact value fits the point")
        initial[name] = value
    return {"version": "1", "initial": initial}


def edge_values(thing_model):
    """Decoding passes: lower bound, upper bound, then high-bit and asymmetric patterns."""
    passes = [{}, {}, {}]
    for name, prop in thing_model["properties"].items():
        form = read_form(prop)
        kind = form["modv:type"]
        if prop["type"] == "boolean" or kind == "xsd:boolean":
            values = [False, True, True]
        elif kind in FLOATS:
            values = [fit(prop, target) for target in (-1024.25, 3.0e38 if kind == "xsd:float" else 1.0e300, 1.5)]
        elif prop["type"] == "string" or kind == "xsd:string":
            size = 2 * form.get("modv:quantity", 1)  # a string holds two characters per register
            values = ["", "AZ"[:size], "Modbus"[:size]]
        else:
            low, high, factor = bounds(prop, form)
            pattern = min(max(0x1234, low), high)
            high_bit = (high + 1) // 2 + 1 if low >= 0 else -1
            values = [scaled(raw, factor) for raw in (low, high, high_bit if low <= high_bit <= high else pattern)]
        for target, value in zip(passes, values):
            if value is not None:
                target[name] = value
    return passes


def main():
    package = Path(sys.argv[1])
    product = yaml.safe_load((package / "product.yaml").read_text(encoding="utf-8"))
    thing_model = json.loads((package / "model.tm.json").read_text(encoding="utf-8"))
    print(json.dumps(preset_data(thing_model, product["category"]), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
