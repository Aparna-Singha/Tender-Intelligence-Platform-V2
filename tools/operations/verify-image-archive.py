"""Read-only Docker-save validator. No extraction, Docker calls or network access."""

import gzip
import hashlib
import json
import re
import sys
import tarfile
from pathlib import PurePosixPath


def digest(stream):
    value = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        value.update(chunk)
    return value.hexdigest(), size


def verify(path, image_id):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ValueError("image identity")
    # Intentionally support uncompressed `docker image save`, not arbitrary exports.
    with open(path, "rb") as raw, tarfile.open(path, mode="r:") as archive:
        members = {}
        hashes = {}
        for member in archive:
            name = member.name
            if (name in members or "\\" in name or
                    PurePosixPath(name).is_absolute() or
                    ".." in PurePosixPath(name).parts or
                    not (member.isfile() or member.isdir())):
                raise ValueError("unsafe or duplicate member")
            members[name] = member
            if member.isfile():
                with archive.extractfile(member) as stream:
                    checksum, length = digest(stream)
                if length != member.size:
                    raise ValueError("truncated member")
                hashes[name] = checksum
                if name.startswith("blobs/sha256/") and name != "blobs/sha256/" + checksum:
                    raise ValueError("blob digest")
        # Require a complete tar terminator, not a silently accepted truncated file.
        raw.seek(archive.offset)
        if raw.read(1024) != b"\0" * 1024:
            raise ValueError("missing tar terminator")

        def read_json(name):
            member = members[name]
            if not member.isfile() or member.size > 16 * 1024 * 1024:
                raise ValueError("invalid metadata")
            with archive.extractfile(member) as stream:
                return json.load(stream)

        manifest = read_json("manifest.json")
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise ValueError("expected one image")
        entry = manifest[0]
        config_name = entry["Config"]
        if hashes.get(config_name) != image_id.removeprefix("sha256:"):
            raise ValueError("config does not match captured image")
        config = read_json(config_name)
        rootfs = config["rootfs"]
        layers = entry["Layers"]
        if rootfs["type"] != "layers" or len(layers) != len(rootfs["diff_ids"]):
            raise ValueError("layer count")
        for name, expected in zip(layers, rootfs["diff_ids"]):
            if not members[name].isfile():
                raise ValueError("layer is not a file")
            with archive.extractfile(name) as stream:
                magic = stream.read(2)
                stream.seek(0)
                if magic == b"\x1f\x8b":
                    with gzip.GzipFile(fileobj=stream) as unpacked:
                        actual, _ = digest(unpacked)
                else:
                    actual = hashes[name]
            if expected != "sha256:" + actual:
                raise ValueError("layer content does not match image config")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("arguments")
        verify(sys.argv[1], sys.argv[2])
    except Exception:
        # Never print archive contents, paths or parser exceptions.
        print("Archive validation failed; details suppressed.", file=sys.stderr)
        sys.exit(1)
    print("Archive structure and captured image content verified; load not rehearsed.")
