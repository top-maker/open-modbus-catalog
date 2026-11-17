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
"""Static checks of catalog Thing Models and their simulation data.

For each package with model.tm.json:

- profile: the TM schema and the modpoll-wot executable profile, which also
  checks that each raw type's width matches its register count;
- consistency: no two points share registers or bits unless they are
  identical aliases or different bits of one register, and each declared
  minimum and maximum fits the raw type after the multiplier;
- data: every readable point gets a value from model.data.json, or from
  simulation-presets.yaml for the product's category, and every value fits
  its point's type, range and multiplier.

W3C WoT validation with Eclipse Thingweb Playground is scripts/check-wot.mjs.
Nothing here runs Modsim or Modpoll: the checks show that a Thing Model is
well formed and consistent, not that its mappings match the hardware.
"""

import argparse
from decimal import Decimal
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

import yaml

from modpoll_wot import DataError, load_simulation_data, loads_model, scaled_raw, validate_standard

from simulation import FLOATS, INTEGER_RANGES, load_presets, preset_data, read_form

ROOT = Path(__file__).resolve().parents[1]
FLOAT_LIMITS = {"xsd:float": struct.unpack(">f", bytes.fromhex("7f7fffff"))[0], "xsd:double": sys.float_info.max}
BIT_TABLES = ("Coil", "DiscreteInput")


class CheckError(ValueError):
    """A package fails a static check."""


def mapping(prop):
    """The Modbus mapping of a property's read Form, with the profile's defaults applied."""
    form = read_form(prop)
    return {
        "entity": form["modv:entity"],
        "address": form["modv:address"],
        "quantity": form.get("modv:quantity", 1),
        "type": form.get("modv:type"),
        "bit": form.get("modpoll:bit"),
        "multiplier": form.get("modpoll:multiplier"),
        "byte": form.get("modv:mostSignificantByte", True),
        "word": form.get("modv:mostSignificantWord", True),
    }


def check_overlaps(thing_model):
    """Two points may share a register or bit only as identical aliases or as different bits of one register."""
    points = sorted((mapping(prop) | {"name": name} for name, prop in thing_model["properties"].items()),
                    key=lambda point: (point["entity"], point["address"]))
    problems = []
    for index, point in enumerate(points):
        for other in points[index + 1:]:
            if other["entity"] != point["entity"] or other["address"] >= point["address"] + point["quantity"]:
                break
            alias = {**point, "name": None} == {**other, "name": None}
            bits = (point["bit"] is not None and other["bit"] is not None and point["bit"] != other["bit"]
                    and point["address"] == other["address"] and point["quantity"] == other["quantity"] == 1)
            if not (alias or bits):
                problems.append(f"{point['name']} and {other['name']} overlap at {other['entity']} {other['address']}")
    return problems


def engineering_limits(point):
    """The smallest and largest engineering value the raw type carries, or None for bits and strings."""
    kind = point["type"]
    if kind in FLOATS:
        return -FLOAT_LIMITS[kind], FLOAT_LIMITS[kind]
    if kind not in INTEGER_RANGES or point["bit"] is not None:
        return None
    low, high = INTEGER_RANGES[kind]
    factor = Decimal(str(point["multiplier"] if point["multiplier"] is not None else 1))
    return min(low * factor, high * factor), max(low * factor, high * factor)


def range_problem(prop, value):
    """Why a numeric value lies outside the point's declared range or raw type, or None."""
    if not prop.get("minimum", value) <= value <= prop.get("maximum", value):
        return f"{value!r} is outside {prop.get('minimum', '')}..{prop.get('maximum', '')}"
    limits = engineering_limits(mapping(prop))
    if limits and not limits[0] <= Decimal(str(value)) <= limits[1]:
        return f"{value!r} is outside {limits[0]}..{limits[1]}, what the raw type carries after the multiplier"
    return None


def check_ranges(thing_model):
    """A declared minimum and maximum must be ordered and fit the raw type after the multiplier."""
    problems = []
    for name, prop in thing_model["properties"].items():
        if prop.get("minimum", -math.inf) > prop.get("maximum", math.inf):
            problems.append(f"{name}: minimum {prop['minimum']} is above maximum {prop['maximum']}")
            continue
        limits = engineering_limits(mapping(prop))
        for key in ("minimum", "maximum"):
            if limits and key in prop and not limits[0] <= Decimal(str(prop[key])) <= limits[1]:
                problems.append(f"{name}: {key} {prop[key]} is outside {limits[0]}..{limits[1]}, "
                                "what the raw type carries after the multiplier")
    return problems


def value_problem(prop, value):
    """Why `value` cannot be served exactly for the point, or None when it can."""
    point = mapping(prop)
    if "const" in prop:
        return None if value == prop["const"] else f"{value!r} is not the constant {prop['const']!r}"
    if "enum" in prop and value not in prop["enum"]:
        return f"{value!r} is not one of {prop['enum']}"
    if prop["type"] == "boolean":
        return None if isinstance(value, bool) else f"{value!r} is not a boolean"
    if prop["type"] == "array":
        if not (isinstance(value, list) and all(isinstance(item, bool) for item in value)):
            return f"{value!r} is not a list of booleans"
        if point["entity"] in BIT_TABLES and len(value) != point["quantity"]:
            return f"{len(value)} booleans for {point['quantity']} bits"
        return None
    if prop["type"] == "string":
        if not isinstance(value, str):
            return f"{value!r} is not a string"
        capacity = read_form(prop).get("modpoll:byteLength", 2 * point["quantity"])
        size = len(value.encode("utf-8"))
        return None if size <= capacity else f"{size} UTF-8 bytes exceed the capacity of {capacity}"
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return f"{value!r} is not a finite number"
    if prop["type"] == "integer" and value != int(value):
        return f"{value!r} is not an integer"
    if (problem := range_problem(prop, value)) or point["type"] in FLOATS:
        return problem
    try:
        raw = int(value) if point["multiplier"] is None else scaled_raw(value, point["multiplier"])
    except DataError as error:
        return str(error)
    low, high = INTEGER_RANGES[point["type"]]
    return None if low <= raw <= high else f"raw value {raw} overflows {point['type']}"


# The extreme engineering values a changing generator produces, by kind.
GENERATOR_EXTREMES = {
    "sine": lambda spec: (spec["center"] - spec["amplitude"], spec["center"] + spec["amplitude"]),
    "ramp": lambda spec: (spec["start"], spec["minimum"], spec["maximum"]),
    "noise": lambda spec: (spec["minimum"], spec["maximum"]),
}


def check_data(thing_model, data):
    """Every readable point has a value, and every value fits its point.

    A static or constant value must be served exactly; a changing value is
    quantized by the simulator, so only its extremes are checked against the range.
    """
    properties = thing_model["properties"]
    problems = []
    values = list(data.get("initial", {}).items())
    for name, spec in data.get("generators", {}).items():
        if spec["kind"] == "constant":
            values.append((name, spec["value"]))
        elif properties[name]["type"] not in ("integer", "number"):
            problems.append(f"{name}: a {spec['kind']} generator needs a numeric point")
        else:
            problems += [f"{name}: {spec['kind']} reaches {problem}" for value in GENERATOR_EXTREMES[spec["kind"]](spec)
                         if (problem := range_problem(properties[name], value))]
    problems += [f"{name}: {problem}" for name, value in values if (problem := value_problem(properties[name], value))]
    served = data.get("initial", {}).keys() | data.get("generators", {}).keys() | data.get("bindings", {}).keys()
    missing = [name for name, prop in properties.items() if not prop.get("writeOnly") and name not in served]
    if missing:
        problems.append(f"no simulation value for {', '.join(missing)}")
    return problems


def simulation_data(package, thing_model, presets):
    authored = package / "model.data.json"
    if authored.exists():
        document = json.loads(authored.read_text(encoding="utf-8"))
        return load_simulation_data(document, properties=thing_model["properties"].keys()).data, "model.data.json"
    category = yaml.safe_load((package / "product.yaml").read_text(encoding="utf-8"))["category"]
    return preset_data(thing_model, category, presets), f"{category} preset"


def check(package, presets):
    """Run the static checks on a package and return the data's origin; raises ValueError on a failure."""
    text = (package / "model.tm.json").read_text(encoding="utf-8")
    thing_model = json.loads(text)
    validate_standard(thing_model, kind="tm")
    loads_model(text, kind="tm")
    problems = check_overlaps(thing_model) + check_ranges(thing_model)
    data, origin = simulation_data(package, thing_model, presets)
    problems += [f"{origin}: {problem}" for problem in check_data(thing_model, data)]
    if problems:
        raise CheckError("\n  ".join(problems))
    return origin


# Files whose change can alter the result of any package.
SHARED_INPUTS = ("scripts/", "simulation-presets.yaml", "categories.yaml", ".github/workflows/")


def packages_to_check(changed_since):
    """Every package with a Thing Model, or only the changed ones since a Git ref.

    A change to a shared input (the checks, presets or workflow) selects all.
    """
    packages = [record.parent for record in sorted(ROOT.glob("products/*/*/product.yaml"))
                if (record.parent / "model.tm.json").exists()]
    if not changed_since:
        return packages
    changed = subprocess.run(
        ["git", "diff", "--name-only", f"{changed_since}...HEAD"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split()
    if any(path.startswith(SHARED_INPUTS) for path in changed):
        return packages
    return [package for package in packages
            if any(path.startswith(package.relative_to(ROOT).as_posix() + "/") for path in changed)]


def main():
    parser = argparse.ArgumentParser(description="Run the static checks on catalog Thing Models.")
    parser.add_argument("--changed-since", metavar="REF",
                        help="check only packages changed since this Git ref (all when shared inputs changed)")
    args = parser.parse_args()
    presets = load_presets()
    packages = packages_to_check(args.changed_since)
    if not packages:
        print("No Thing Model changed.")
        return 0
    failed = False
    for package in packages:
        label = package.relative_to(ROOT / "products").as_posix()
        try:
            print(f"✓ {label}: profile, consistency, {check(package, presets)}")
        except ValueError as error:  # CheckError, and modpoll-wot's DataError and AcquisitionError
            failed = True
            print(f"✗ {label}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
