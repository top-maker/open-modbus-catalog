# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "modpoll==2.0.0a5",
#     "modsim==2.0.0a6",
#     "pyyaml==6.0.3",
# ]
#
# [tool.uv]
# prerelease = "allow"
# ///
"""Validate catalog Thing Models and run the simulation check.

For each package with model.tm.json, check the executable profile, then serve
its scenario with Modsim and read it once with Modpoll. The scenario is
model.sim.json, or one generated from simulation-presets.yaml for the
product's category. Static values must read back unchanged and changing values
must stay within their range. Three more passes serve values derived from each
point's type (bounds, high bit, asymmetric patterns) to check decoding. The
check shows that a Thing Model executes consistently; it does not show that
its point mappings match real hardware.
"""

import json
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

import yaml

from simulation import edge_values, load_presets, preset_scenario

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 30


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


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_for(port, server):
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"modsim exited:\n{server.stdout.read()}")
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("modsim did not start listening")


def simulated_read(model, scenario):
    port = free_port()
    with TemporaryDirectory() as directory:
        source = Path(directory) / "scenario.sim.json"
        source.write_text(json.dumps(scenario))
        server = subprocess.Popen(
            [sys.executable, "-m", "modsim", "--config", str(model), "--scenario", str(source),
             "--bind", "127.0.0.1", "--port", str(port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_for(port, server)
            output = Path(directory) / "read.json"
            run("modpoll", "--config", str(model), "--tcp", "127.0.0.1",
                "--tcp-port", str(port), "--once", "--export", str(output))
            (values,) = json.loads(output.read_text()).values()
            return values
        finally:
            server.terminate()
            server.wait(timeout=TIMEOUT)


def compare(expected, actual):
    mismatched = {name: (value, actual.get(name)) for name, value in expected.items() if actual.get(name) != value}
    if mismatched:
        raise RuntimeError(f"read back differs (expected, actual): {mismatched}")


def check_scenario(model, thing_model, scenario):
    actual = simulated_read(model, scenario)
    generators = scenario.get("generators", {})
    static = {name: value for name, value in scenario.get("initial", {}).items() if name not in generators}
    static |= {name: spec["value"] for name, spec in generators.items() if spec["kind"] == "constant"}
    compare(static, actual)
    for name, prop in thing_model["properties"].items():
        value = actual.get(name)
        if value is None:
            raise RuntimeError(f"scenario served no value for {name}")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and not (
                prop.get("minimum", value) <= value <= prop.get("maximum", value)):
            raise RuntimeError(f"{name} read {value} outside its range")


def check(package, presets):
    model = package / "model.tm.json"
    run("modpoll_wot", "validate", str(model), "--kind", "tm", "--profile")
    thing_model = json.loads(model.read_text())
    authored = package / "model.sim.json"
    if authored.exists():
        scenario, origin = json.loads(authored.read_text()), "model.sim.json"
    else:
        category = yaml.safe_load((package / "product.yaml").read_text())["category"]
        scenario, origin = preset_scenario(thing_model, category, presets), f"{category} preset"
    check_scenario(model, thing_model, scenario)
    passes = edge_values(thing_model)
    for values in passes:
        compare(values, simulated_read(model, {"version": "1", "initial": values}))
    return ["profile", origin, f"{len(passes)} decoding passes"]


def main():
    failed = False
    presets = load_presets()
    for record in sorted(ROOT.glob("products/*/*/product.yaml")):
        if not (record.parent / "model.tm.json").exists():
            continue
        label = record.parent.relative_to(ROOT / "products").as_posix()
        try:
            print(f"✓ {label}: {', '.join(check(record.parent, presets))}")
        except Exception as error:  # noqa: BLE001 - report every model
            failed = True
            print(f"✗ {label}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
