import argparse
import base64
import hashlib
import io
import json
import pathlib
import re
import tarfile
import urllib.parse
import urllib.request
import zlib

MAX_ARCHIVE = 8 * 1024 * 1024
MAX_CONTENT = 32 * 1024 * 1024
MAX_CONFIG = 524288


def pin_from_lock(lock, package):
    if not re.fullmatch(r"(?:@[a-z0-9._-]+/)?[a-z0-9._-]+", package):
        raise ValueError("Invalid package name")
    pin = lock.get("packages", {}).get("node_modules/" + package, {})
    version, url, integrity = (pin.get(k, "") for k in ("version", "resolved", "integrity"))
    parsed = urllib.parse.urlsplit(url)
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Exact lockfile version required")
    expected_path = "/" + package + "/-/" + package.split("/")[-1] + "-" + version + ".tgz"
    if (parsed.scheme != "https" or parsed.netloc != "registry.npmjs.org"
            or parsed.path != expected_path or parsed.query or parsed.fragment):
        raise ValueError("Only an exact public registry.npmjs.org package URL is allowed")
    if not re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", integrity):
        raise ValueError("Pinned SHA512 integrity required")
    return {"package": package, "version": version, "url": url, "integrity": integrity}


def extract_config(data, pin, entry):
    if (len(data) > MAX_ARCHIVE or not entry.endswith(".json")
            or entry.startswith("/") or "\\" in entry
            or any(p in ("", ".", "..") for p in entry.split("/"))):
        raise ValueError("Unsafe archive or config path")
    expected = base64.b64decode(pin["integrity"].split("-", 1)[1], validate=True)
    if hashlib.sha512(data).digest() != expected:
        raise ValueError("Archive integrity mismatch")
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    raw = decoder.decompress(data, MAX_CONTENT + 1)
    if len(raw) > MAX_CONTENT or decoder.unconsumed_tail or not decoder.eof or decoder.unused_data:
        raise ValueError("Oversized or ambiguous compressed archive")
    source = None
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        seen = set()
        for number, member in enumerate(archive):
            if number >= 10000:
                raise ValueError("Archive entry cap exceeded")
            if (member.name.startswith("/") or "\\" in member.name
                    or ".." in member.name.split("/") or member.name in seen):
                raise ValueError("Unsafe or duplicate archive entry")
            seen.add(member.name)
            if member.name != "package/" + entry:
                continue
            if not member.isfile() or member.size > MAX_CONFIG:
                raise ValueError("Config must be a bounded regular file")
            content = archive.extractfile(member).read(MAX_CONFIG + 1)
            source = content.decode("utf-8", errors="strict")
            if len(content) != member.size or "\0" in source:
                raise ValueError("Invalid config content")
    if source is None:
        raise ValueError("Config absent from pinned archive")
    return source


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Registry redirects are not permitted")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--entry", required=True)
    parser.add_argument("--specifier", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--archive")
    args = parser.parse_args()
    lock_bytes = pathlib.Path(args.lock).read_bytes()
    pin = pin_from_lock(json.loads(lock_bytes), args.package)
    if args.specifier not in (args.package, args.package + "/" + args.entry.removesuffix(".json")):
        raise ValueError("Specifier must identify the selected package config")
    output = pathlib.Path(args.out)
    if output.resolve().is_relative_to(pathlib.Path(args.lock).resolve().parent):
        raise ValueError("Output must be outside the target repository")
    if output.exists():
        raise ValueError("Output must be new")
    if args.archive:
        with open(args.archive, "rb") as stream:
            data = stream.read(MAX_ARCHIVE + 1)
    else:
        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(pin["url"], timeout=20) as response:
            if response.status != 200:
                raise ValueError("Registry response refused")
            data = response.read(MAX_ARCHIVE + 1)
    source = extract_config(data, pin, args.entry)
    archive_sha = hashlib.sha256(data).hexdigest()
    receipt = {**pin, "archiveSHA256": archive_sha,
               "lockfileSHA256": hashlib.sha256(lock_bytes).hexdigest(),
               "entry": args.entry, "sourceSHA256": hashlib.sha256(source.encode()).hexdigest(),
               "verification": "SHA512 archive checked against exact lockfile pin; config extracted as data only",
               "scriptsExecuted": False, "archiveExtractedToFilesystem": False}
    bundle = [{"specifier": args.specifier, "package": args.package,
               "version": pin["version"], "integrity": pin["integrity"],
               "provenance": "pinned-config.py archive SHA256 " + archive_sha,
               "verifiedByCaller": True, "entry": args.entry, "files": {args.entry: source}}]
    output.mkdir(parents=True, mode=0o700)
    (output / "archive.tgz").write_bytes(data)
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (output / "external-configs.json").write_text(json.dumps(bundle, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Pinned config acquisition refused; no source or raw exception echoed")
