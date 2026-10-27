"""Checks the inline Python bootstrap in template/sendless.yaml.

Inline Lambda code is limited to 4096 characters, and if it fails to answer CloudFormation the
stack hangs until the custom resource times out. This test extracts the code, runs it against a
local stand-in for the CloudFormation response endpoint and asserts that it always answers.

    python3 scripts/check-bootstrap.py
"""
import hashlib
import http.server
import io
import json
import re
import sys
import threading
import types
import urllib.request

source = open('template/sendless.yaml', encoding='utf-8').read()
match = re.search(r'ZipFile: \|\n((?:          .*\n|\n)+)', source)
assert match, 'inline bootstrap not found'
code = '\n'.join(line[10:] for line in match.group(1).splitlines())
assert len(code) <= 4096, f'inline code is {len(code)} characters (limit 4096)'

responses = []


class CloudFormation(http.server.BaseHTTPRequestHandler):
    def do_PUT(self):
        responses.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


server = http.server.HTTPServer(('127.0.0.1', 0), CloudFormation)
threading.Thread(target=server.serve_forever, daemon=True).start()


class FakeS3:
    def __init__(self):
        self.deleted = []

    def get_paginator(self, name):
        return types.SimpleNamespace(paginate=lambda Bucket: [{'Contents': [{'Key': 'v1/backend.zip'}]}])

    def delete_objects(self, Bucket, Delete):
        self.deleted += [o['Key'] for o in Delete['Objects']]

    def put_object(self, Bucket, Key, Body):
        pass


# Release downloads are answered locally; the CloudFormation response still goes to the local server.
fetched = []
real_urlopen = urllib.request.urlopen


class Download(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def urlopen(req, timeout=None):
    url = req if isinstance(req, str) else req.full_url
    if url.startswith('https://releases.example/'):
        fetched.append(url)
        return Download(b'artifact')
    return real_urlopen(req, timeout=timeout)


urllib.request.urlopen = urlopen


fake_s3 = FakeS3()
sys.modules['boto3'] = types.SimpleNamespace(client=lambda *a, **k: fake_s3)
namespace = {}
exec(code, namespace)


def run(request_type, base_url='https://example.invalid', artifacts=()):
    event = {
        'RequestType': request_type,
        'ResponseURL': f'http://127.0.0.1:{server.server_port}/response',
        'StackId': 'stack',
        'RequestId': 'request',
        'LogicalResourceId': 'Bootstrap',
        'ResourceProperties': {'Bucket': 'artifacts', 'BaseUrl': base_url, 'Artifacts': list(artifacts)},
    }
    namespace['handler'](event, None)
    return responses[-1]


assert run('Create', base_url='http://insecure')['Status'] == 'FAILED', 'http:// must be rejected'
assert run('Create')['Status'] == 'SUCCESS'

# ArtifactBaseUrl names the folder above the version folders. Values saved by 1.5.0 and earlier
# name a version folder; updates that keep them must still fetch the new release.
artifact = {'Name': 'v1.6.0/backend.zip', 'Key': 'v1.6.0/backend.zip', 'Sha256': hashlib.sha256(b'artifact').hexdigest()}
for base in ['https://releases.example', 'https://releases.example/', 'https://releases.example/v1.5.0', 'https://releases.example/v1.5.0/']:
    fetched.clear()
    assert run('Update', base_url=base, artifacts=[artifact])['Status'] == 'SUCCESS', base
    assert fetched == ['https://releases.example/v1.6.0/backend.zip'], (base, fetched)
assert run('Update', base_url='https://releases.example', artifacts=[dict(artifact, Sha256='0' * 64)])['Status'] == 'FAILED', 'checksum mismatch must fail'
deleted = run('Delete')
assert deleted['Status'] == 'SUCCESS' and fake_s3.deleted == ['v1/backend.zip'], 'delete must empty the bucket'
assert all(r['PhysicalResourceId'] == 'artifacts-artifacts' for r in responses), 'physical ID must be stable'
print(f'bootstrap ok ({len(code)} of 4096 characters, {len(responses)} responses)')
