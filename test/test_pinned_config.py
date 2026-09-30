import base64
import gzip
import hashlib
import importlib.util
import io
import pathlib
import tarfile
import unittest

spec = importlib.util.spec_from_file_location("pinned_config", pathlib.Path(__file__).resolve().parent.parent / "scripts" / "pinned-config.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive(name="package/tsconfig.base.json", content=b'{"compilerOptions":{}}', kind=tarfile.REGTYPE, duplicate=False):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for _ in range(2 if duplicate else 1):
            item = tarfile.TarInfo(name)
            item.size = len(content) if kind == tarfile.REGTYPE else 0
            item.type = kind
            item.linkname = "../../outside"
            tar.addfile(item, io.BytesIO(content) if item.size else None)
    data = gzip.compress(buffer.getvalue())
    return data, {"integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()}


class PinnedConfigTests(unittest.TestCase):
    def test_exact_integrity_and_regular_data(self):
        data, pin = archive()
        self.assertEqual(module.extract_config(data, pin, "tsconfig.base.json"), '{"compilerOptions":{}}')

    def test_integrity_mismatch(self):
        data, pin = archive()
        with self.assertRaises(ValueError):
            module.extract_config(data + b"x", pin, "tsconfig.base.json")

    def test_traversal_symlink_and_duplicate(self):
        for args in ({"name": "../../outside"}, {"kind": tarfile.SYMTYPE}, {"duplicate": True}):
            with self.subTest(args=args):
                data, pin = archive(**args)
                with self.assertRaises(ValueError):
                    module.extract_config(data, pin, "tsconfig.base.json")

    def test_entry_and_content_bounds(self):
        data, pin = archive()
        for entry in ("../tsconfig.base.json", "/tsconfig.base.json", "file.js"):
            with self.assertRaises(ValueError):
                module.extract_config(data, pin, entry)
        data, pin = archive(content=b"x" * (module.MAX_CONFIG + 1))
        with self.assertRaises(ValueError):
            module.extract_config(data, pin, "tsconfig.base.json")

    def test_invalid_utf8_and_nul(self):
        for content in (b"\xff", b"\x00"):
            data, pin = archive(content=content)
            with self.assertRaises((ValueError, UnicodeError)):
                module.extract_config(data, pin, "tsconfig.base.json")

    def test_host_credentials_redirect_and_exact_pin(self):
        _, pin = archive()
        value = {"version": "1.2.3", "resolved": "https://registry.npmjs.org/example/-/example-1.2.3.tgz", "integrity": pin["integrity"]}
        lock = {"packages": {"node_modules/example": value}}
        self.assertEqual(module.pin_from_lock(lock, "example")["version"], "1.2.3")
        for url in ("https://evil.test/a", "https://user:pass@registry.npmjs.org/example/-/example-1.2.3.tgz", value["resolved"] + "?secret=x", value["resolved"].replace("1.2.3", "1.2.4")):
            with self.assertRaises(ValueError):
                module.pin_from_lock({"packages": {"node_modules/example": {**value, "resolved": url}}}, "example")
        with self.assertRaises(ValueError):
            module.NoRedirect().redirect_request(None, None, 302, None, None, "https://evil.test")


if __name__ == "__main__":
    unittest.main()
