"""Synthetic archive tests only; no Docker or staging reads."""
import hashlib
import gzip
import importlib.util
import io
import json
import re
import subprocess
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "verifier", Path(__file__).with_name("verify-image-archive.py")
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ArchiveTests(unittest.TestCase):
    def test_candidate_probe(self):
        script = Path(__file__).with_name("tender-diagnostics.ps1").read_text()
        function = script.split("function Assert-CandidateInstrumentation", 1)[1]
        probe = re.search(r"\$probe = @'\n(.*?)\n'@", function, re.S)[1]
        module = "export function beginTenderDetailTiming(request, enabled) {}"
        main = "import { beginTenderDetailTiming } from './common/tender-detail-timing.js';\nfastify.addHook('onRequest', (request, reply, done) => { beginTenderDetailTiming(request, environment.API_TENDER_LATENCY_DIAGNOSTICS, startedAt); });"
        cases = [(module, main, 0), (None, main, 1), ("", main, 1),
                 (module, "", 1), (module, main.split("\n")[0], 1),
                 (module, main.replace("environment.API_TENDER_LATENCY_DIAGNOSTICS", "true"), 1)]
        harness = """
const fs = require('node:fs'), vm = require('node:vm');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
let code = 0;
try {
  vm.runInNewContext(data.probe, {
    require: () => ({ readFileSync: p => {
      const value = p.endsWith('/main.js') ? data.main : data.module;
      if (value === null) throw Error('missing');
      return value;
    }}),
    process: { exit: n => { code = n; throw Error('exit'); } }
  }, {timeout: 1000});
} catch { if (!code) code = 2; }
process.exitCode = code;
"""
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "probe.json"
            for module_text, main_text, expected in cases:
                path.write_text(json.dumps({"probe": probe, "module": module_text, "main": main_text}))
                result = subprocess.run(["node", "-e", harness, str(path)], capture_output=True)
                self.assertEqual(result.returncode, expected)

    def fixture(self, folder, change=None):
        layer = b"\0" * 10240  # Empty synthetic layer tar, no application/private data.
        config = json.dumps({"rootfs": {"type": "layers", "diff_ids": ["sha256:" + sha(layer)]}}).encode()
        name = "blobs/sha256/" + sha(config)
        layer_name = "blobs/sha256/" + sha(layer)
        manifest = [{"Config": name, "Layers": [layer_name], "RepoTags": None}]
        files = {name: config, layer_name: layer, "manifest.json": json.dumps(manifest).encode()}
        if change:
            change(files, name, layer_name)
        path = Path(folder) / "synthetic.tar"
        with tarfile.open(path, "w") as archive:
            for filename, data in files.items():
                entry = tarfile.TarInfo(filename)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
        return path, "sha256:" + sha(config)

    def test_valid(self):
        with tempfile.TemporaryDirectory() as folder:
            verifier.verify(*self.fixture(folder))

    def test_wrong_captured_image(self):
        with tempfile.TemporaryDirectory() as folder:
            path, _ = self.fixture(folder)
            with self.assertRaises(ValueError):
                verifier.verify(path, "sha256:" + "0" * 64)

    def test_compressed_layer(self):
        def compress(files, config, layer):
            compressed = gzip.compress(files.pop(layer))
            name = "blobs/sha256/" + sha(compressed)
            files[name] = compressed
            files["manifest.json"] = json.dumps([{"Config": config, "Layers": [name]}]).encode()
        with tempfile.TemporaryDirectory() as folder:
            verifier.verify(*self.fixture(folder, compress))

    def test_invalid_archives(self):
        changes = {
            "missing layer": lambda f, c, l: f.pop(l),
            "corrupt layer": lambda f, c, l: f.update({l: b"tampered"}),
            "corrupt config": lambda f, c, l: f.update({c: b"{}"}),
            "invalid manifest": lambda f, c, l: f.update({"manifest.json": b"[]"}),
            "path traversal": lambda f, c, l: f.update({"../outside": b"bad"}),
            "invalid json": lambda f, c, l: f.update({"manifest.json": b"not json"}),
            "wrong layer linkage": lambda f, c, l: f.update({"manifest.json": json.dumps([{"Config": c, "Layers": [c]}]).encode()}),
        }
        for label, change in changes.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as folder:
                args = self.fixture(folder, change)
                with self.assertRaises((ValueError, KeyError)):
                    verifier.verify(*args)

    def test_truncated(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.fixture(folder)
            path.write_bytes(path.read_bytes()[:2048])
            with self.assertRaises((ValueError, tarfile.TarError)):
                verifier.verify(path, image)

    def test_missing_terminator(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.fixture(folder)
            with tarfile.open(path) as archive:
                list(archive)
                end = archive.offset
            path.write_bytes(path.read_bytes()[:end])
            with self.assertRaises(ValueError):
                verifier.verify(path, image)

    def test_duplicate_member(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.fixture(folder)
            with tarfile.open(path, "a") as archive:
                item = tarfile.TarInfo("manifest.json")
                item.size = 2
                archive.addfile(item, io.BytesIO(b"[]"))
            with self.assertRaises(ValueError):
                verifier.verify(path, image)

    def test_link(self):
        with tempfile.TemporaryDirectory() as folder:
            path, image = self.fixture(folder)
            with tarfile.open(path, "a") as archive:
                item = tarfile.TarInfo("link")
                item.type = tarfile.SYMTYPE
                item.linkname = "/outside"
                archive.addfile(item)
            with self.assertRaises(ValueError):
                verifier.verify(path, image)


if __name__ == "__main__":
    unittest.main()
