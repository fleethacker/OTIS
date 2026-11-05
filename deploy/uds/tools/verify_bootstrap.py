#!/usr/bin/env python3
"""Exercise packaged inference twice and after restart on a new internal Docker network.

This proves offline model/bootstrap behavior, not UDS admission or mesh policy.
The test's newly-created search volume is retained for inspection.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid


def run(*command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)


def output(*command):
    try:
        return subprocess.check_output(command, text=True).strip()
    except subprocess.CalledProcessError as error:
        print((error.output or '')[-8192:], flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    args = parser.parse_args()
    images = json.loads((args.release / 'artifact-lock.json').read_text())['images']
    prefix = 'parse-command-bootstrap-check-' + uuid.uuid4().hex[:10]
    network, volume, search = prefix + '-net', prefix + '-data', prefix + '-search'
    run('docker', 'network', 'create', '--internal', '--label', 'dev.parse-command.validation=true', network, stdout=subprocess.DEVNULL)
    container = None
    try:
        run('docker', 'volume', 'create', '--label', 'dev.parse-command.validation=true', volume, stdout=subprocess.DEVNULL)
        container = output('docker', 'run', '-d', '--pull=never', '--name', search, '--network', network, '--network-alias', 'opensearch', '--memory=3g', '--pids-limit=256', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--ulimit', 'nofile=65536:65536', '-v', volume + ':/usr/share/opensearch/data', '-e', 'discovery.type=single-node', '-e', 'DISABLE_SECURITY_PLUGIN=true', '-e', 'DISABLE_INSTALL_DEMO_CONFIG=true', '-e', 'DJL_OFFLINE=true', '-e', 'OMP_NUM_THREADS=1', '-e', 'OPENBLAS_NUM_THREADS=1', '-e', 'MKL_NUM_THREADS=1', '-e', 'OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m -Dai.djl.offline=true -Dai.djl.onnxruntime.num_interop_threads=1 -Dai.djl.onnxruntime.num_intraop_threads=1 -Dai.djl.pytorch.num_interop_threads=1 -Dai.djl.pytorch.num_threads=1', images['SEARCH_IMAGE'])
        def ready():
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                result = subprocess.run(['docker', 'exec', search, 'curl', '--fail', '--max-time', '3', '-s', 'http://127.0.0.1:9200/_cluster/health'], capture_output=True, text=True)
                if result.returncode == 0 and json.loads(result.stdout).get('status') in ['green', 'yellow']:
                    return
                time.sleep(3)
            raise RuntimeError('isolated search did not become ready; inspect retained test volume/events')
        def bootstrap():
            value = output('docker', 'run', '--rm', '--pull=never', '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=32m', '-e', 'PARSE_COMMAND_OPENSEARCH_URL=http://opensearch:9200', images['BOOTSTRAP_IMAGE'])
            return json.loads(value.splitlines()[-1])
        ready()
        first, second = bootstrap(), bootstrap()
        assert first['model_id'] == second['model_id']
        run('docker', 'restart', search, stdout=subprocess.DEVNULL)
        ready()
        third = bootstrap()
        assert first['model_id'] == third['model_id'] and third['actual_inference'] == 'ready'
        print(json.dumps({'verified': 'isolated_offline_bootstrap_repeat_and_restart', 'dimension': third['dimension'], 'model_id_stable': True, 'retainedTestVolume': volume}))
    except Exception:
        if container:
            logs = subprocess.run(['docker', 'logs', '--tail', '80', container], capture_output=True, text=True)
            print((logs.stdout + logs.stderr)[-16000:], flush=True)
        raise
    finally:
        if container:
            subprocess.run(['docker', 'stop', '--time', '30', container], check=False, stdout=subprocess.DEVNULL)
            subprocess.run(['docker', 'rm', container], check=False, stdout=subprocess.DEVNULL)
        subprocess.run(['docker', 'network', 'rm', network], check=False, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
