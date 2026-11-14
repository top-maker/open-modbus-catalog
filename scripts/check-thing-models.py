# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "modpoll==2.0.0a12",
#     "modsim==2.0.0a14",
#     "pyyaml==6.0.3",
# ]
#
# [tool.uv]
# prerelease = "allow"
# ///
"""Validate catalog Thing Models and run the simulation check.

For each package with model.tm.json, check the executable profile, then serve
its simulation data with Modsim and read it once with Modpoll. The data is
model.data.json, checked by modpoll-wot, or static data generated from
simulation-presets.yaml for the product's category. Static values must read back unchanged
(scaled and single-precision values as Modpoll reads them) and changing values
must stay within their range. Three more passes serve values derived from each
point's type (bounds, high bit, asymmetric patterns) to check decoding. The
check shows that a Thing Model executes consistently; it does not show that
its point mappings match real hardware.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

import yaml

from modpoll_wot import load_simulation_data, scaled_raw

from simulation import edge_values, load_presets, preset_data, read_form

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 30
ATTEMPTS = 3


def run(*args):
    result = subprocess.run(
        [sys.executable, "-m", *args],
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed:\n{result.stdout}{result.stderr}")
    return result.stdout


class ServerStartError(RuntimeError):
    """Modsim exited before it listened, for example when the port was taken."""


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_for(port, server, log):
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise ServerStartError(f"modsim exited:\n{log.read_text()}")
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("modsim did not start listening")


def simulated_read(model, data):
    """Serve `data` with Modsim and read it once with Modpoll.

    The port is chosen before Modsim binds it, so another process can take it in
    between; a start that fails is retried on a new port.
    """
    for attempt in range(ATTEMPTS):
        try:
            return _simulated_read(model, data)
        except ServerStartError:
            if attempt == ATTEMPTS - 1:
                raise


def _simulated_read(model, data):
    port = free_port()
    with TemporaryDirectory() as directory:
        source = Path(directory) / "model.data.json"
        source.write_text(json.dumps(data))
        # A file, not a pipe: Modsim's log can never fill a buffer nobody reads.
        log = Path(directory) / "modsim.log"
        with log.open("w") as sink:
            server = subprocess.Popen(
                [sys.executable, "-m", "modsim", "--config", str(model), "--data", str(source),
                 "--bind", "127.0.0.1", "--port", str(port)],
                stdout=sink,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                wait_for(port, server, log)
                output = Path(directory) / "read.json"
                run("modpoll", "--config", str(model), "--tcp", "127.0.0.1",
                    "--tcp-port", str(port), "--once", "--export", str(output))
                (values,) = json.loads(output.read_text()).values()
                return values
            finally:
                server.terminate()
                try:
                    server.wait(timeout=TIMEOUT)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


def single(value):
    """The single-precision value a number names."""
    return struct.unpack(">f", struct.pack(">f", value))[0]


def is_single(thing_model, name):
    form = read_form(thing_model["properties"][name])
    return form.get("modv:type") == "xsd:float" and form.get("modpoll:multiplier") is None


def compare(thing_model, expected, actual):
    """Modpoll prints an xsd:float as the shortest decimal that names the register's value
    (230.2 for 230.1999969482422), so such points are compared as single-precision values."""
    def same(name, value):
        read = actual.get(name)
        if isinstance(read, (int, float)) and not isinstance(read, bool) and is_single(thing_model, name):
            return single(read) == value
        return read == value
    mismatched = {name: (value, actual.get(name)) for name, value in expected.items() if not same(name, value)}
    if mismatched:
        raise RuntimeError(f"read back differs (expected, actual): {mismatched}")


def as_read(thing_model, name, value):
    """The value Modpoll reads for a static value: float(raw) * multiplier for scaled
    points, and the nearest single-precision value for xsd:float points."""
    form = read_form(thing_model["properties"][name])
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    multiplier = form.get("modpoll:multiplier")
    if is_single(thing_model, name):
        return single(value)
    if multiplier is None:
        return value
    return float(scaled_raw(value, multiplier)) * float(multiplier)


def check_data(model, thing_model, data):
    actual = simulated_read(model, data)
    generators = data.get("generators", {})
    static = {name: value for name, value in data.get("initial", {}).items() if name not in generators}
    static |= {name: spec["value"] for name, spec in generators.items() if spec["kind"] == "constant"}
    compare(thing_model, {name: as_read(thing_model, name, value) for name, value in static.items()}, actual)
    for name, prop in thing_model["properties"].items():
        value = actual.get(name)
        if value is None:
            raise RuntimeError(f"simulation data served no value for {name}")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and not (
                prop.get("minimum", value) <= value <= prop.get("maximum", value)):
            raise RuntimeError(f"{name} read {value} outside its range")


def check(package, presets):
    model = package / "model.tm.json"
    run("modpoll_wot", "validate", str(model), "--kind", "tm", "--profile")
    thing_model = json.loads(model.read_text())
    authored = package / "model.data.json"
    if authored.exists():
        data = load_simulation_data(
            json.loads(authored.read_text()), properties=thing_model["properties"].keys()
        ).data
        origin = "model.data.json"
    else:
        category = yaml.safe_load((package / "product.yaml").read_text())["category"]
        data, origin = preset_data(thing_model, category, presets), f"{category} preset"
    check_data(model, thing_model, data)
    passes = edge_values(thing_model)
    for values in passes:
        compare(thing_model, values, simulated_read(model, {"version": "1", "initial": values}))
    return ["profile", origin, f"{len(passes)} decoding passes"]


# Files whose change can alter the result of any package.
SHARED_INPUTS = ("scripts/", "simulation-presets.yaml", "categories.yaml", ".github/workflows/")


def packages_to_check(changed_since):
    """Every package with a Thing Model, or only the changed ones since a Git ref.

    A change to a shared input (the checks, presets or workflow) selects all.
    """
    packages = [
        record.parent for record in sorted(ROOT.glob("products/*/*/product.yaml"))
        if (record.parent / "model.tm.json").exists()
    ]
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


def check_package(package, presets):
    label = package.relative_to(ROOT / "products").as_posix()
    try:
        return label, ", ".join(check(package, presets)), None
    except Exception as error:  # noqa: BLE001 - report every model
        return label, None, error


def main():
    parser = argparse.ArgumentParser(description="Validate catalog Thing Models and run the simulation check.")
    parser.add_argument("--changed-since", metavar="REF",
                        help="check only packages changed since this Git ref (all when shared inputs changed)")
    parser.add_argument("--jobs", type=int, default=min(4, os.cpu_count() or 1),
                        help="packages checked in parallel (default: %(default)s)")
    args = parser.parse_args()
    presets = load_presets()
    packages = packages_to_check(args.changed_since)
    if not packages:
        print("No Thing Model changed.")
        return 0
    failed = False
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for label, summary, error in pool.map(lambda package: check_package(package, presets), packages):
            if error is None:
                print(f"✓ {label}: {summary}")
            else:
                failed = True
                print(f"✗ {label}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
