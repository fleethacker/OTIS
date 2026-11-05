#!/usr/bin/env python3
"""Connected preparation only; deploy.py never downloads public model assets."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
URL = ('https://artifacts.opensearch.org/models/ml-models/huggingface/'
       'sentence-transformers/all-MiniLM-L6-v2/1.0.1/onnx/'
       'sentence-transformers_all-MiniLM-L6-v2-1.0.1-onnx.zip')


def main():
    pin = json.loads((ROOT / 'model.json').read_text())
    directory = ROOT / 'assets'
    directory.mkdir(exist_ok=True)
    archive = directory / 'model.zip'
    if not archive.exists():
        partial = directory / 'model.zip.part'
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(URL, timeout=60) as response, partial.open('wb') as out:
            while True:
                block = response.read(1_048_576)
                if not block:
                    break
                size += len(block)
                if size > pin['model_content_size_in_bytes']:
                    raise RuntimeError('model_archive_size_limit')
                digest.update(block)
                out.write(block)
        if digest.hexdigest() != pin['model_content_hash_value']:
            raise RuntimeError('model_checksum_mismatch')
        partial.replace(archive)
    if archive.stat().st_size != pin['model_content_size_in_bytes']:
        raise RuntimeError('model_archive_size_mismatch')
    with archive.open('rb') as source:
        digest = hashlib.sha256()
        for block in iter(lambda: source.read(1_048_576), b''):
            digest.update(block)
    if digest.hexdigest() != pin['model_content_hash_value']:
        raise RuntimeError('model_checksum_mismatch')
    import zipfile
    with zipfile.ZipFile(archive) as bundle:
        names = [name for name in bundle.namelist() if name.rsplit('/', 1)[-1] == 'tokenizer.json']
        if len(names) != 1 or bundle.getinfo(names[0]).file_size > 4_194_304:
            raise RuntimeError('tokenizer_archive_layout')
        (directory / 'tokenizer.json').write_bytes(bundle.read(names[0]))
    print(json.dumps({'archive': str(archive), 'sha256': digest.hexdigest()}))


if __name__ == '__main__':
    main()
