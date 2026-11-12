# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "modpoll==2.0.0a5",
#     "modsim==2.0.0a6",
# ]
#
# [tool.uv]
# prerelease = "allow"
# ///
"""Validate catalog Thing Models and run the simulation round trip.

For each listed Thing Model, check the WoT structure and executable profile.
When a package lists vectors, serve them with Modsim and require one Modpoll
read to return exactly those values. Each declarative scenario must serve a
value for every property. The round trip shows that the Thing Model executes
consistently; it does not show that its point mappings match real hardware.
"""

import json
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

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


def simulated_read(model, *source):
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "modsim", "--config", str(model), *source,
         "--bind", "127.0.0.1", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for(port, server)
        with TemporaryDirectory() as directory:
            output = Path(directory) / "read.json"
            run("modpoll", "--config", str(model), "--tcp", "127.0.0.1",
                "--tcp-port", str(port), "--once", "--export", str(output))
            (values,) = json.loads(output.read_text()).values()
            return values
    finally:
        server.terminate()
        server.wait(timeout=TIMEOUT)


def check(package, entry):
    model = package / entry["path"]
    run("modpoll_wot", "validate", str(model), "--kind", "tm", "--profile")
    properties = set(json.loads(model.read_text())["properties"])
    results = ["profile"]
    if "vectors" in entry:
        expected = json.loads((package / entry["vectors"]).read_text())
        actual = simulated_read(model, "--initial-file", str(package / entry["vectors"]))
        mismatched = {
            name: (value, actual.get(name))
            for name, value in expected.items()
            if actual.get(name) != value
        }
        if mismatched:
            raise RuntimeError(f"vector mismatch (expected, actual): {mismatched}")
        results.append(f"{len(expected)} vectors")
    for scenario in entry.get("scenarios", []):
        actual = simulated_read(model, "--scenario", str(package / scenario))
        missing = sorted(name for name in properties if actual.get(name) is None)
        if missing:
            raise RuntimeError(f"{scenario} served no value for {missing}")
        results.append(Path(scenario).name)
    return results


def main():
    failed = False
    for record in sorted(ROOT.glob("products/*/*/product.json")):
        product = json.loads(record.read_text())
        for entry in product.get("thingModels", []):
            label = f"{product['id']} {entry['path']}"
            try:
                print(f"✓ {label}: {', '.join(check(record.parent, entry))}")
            except Exception as error:  # noqa: BLE001 - report every model
                failed = True
                print(f"✗ {label}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
