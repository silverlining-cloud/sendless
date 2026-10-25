"""Checks the inline Python bootstrap in template/sendless.yaml.

Inline Lambda code is limited to 4096 characters, and if it fails to answer CloudFormation the
stack hangs until the custom resource times out. This test extracts the code, runs it against a
local stand-in for the CloudFormation response endpoint and asserts that it always answers.

    python3 scripts/check-bootstrap.py
"""
import http.server
import json
import re
import sys
import threading
import types

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


fake_s3 = FakeS3()
sys.modules['boto3'] = types.SimpleNamespace(client=lambda *a, **k: fake_s3)
namespace = {}
exec(code, namespace)


def run(request_type, base_url='https://example.invalid'):
    event = {
        'RequestType': request_type,
        'ResponseURL': f'http://127.0.0.1:{server.server_port}/response',
        'StackId': 'stack',
        'RequestId': 'request',
        'LogicalResourceId': 'Bootstrap',
        'ResourceProperties': {'Bucket': 'artifacts', 'BaseUrl': base_url, 'Artifacts': []},
    }
    namespace['handler'](event, None)
    return responses[-1]


assert run('Create', base_url='http://insecure')['Status'] == 'FAILED', 'http:// must be rejected'
assert run('Create')['Status'] == 'SUCCESS'
deleted = run('Delete')
assert deleted['Status'] == 'SUCCESS' and fake_s3.deleted == ['v1/backend.zip'], 'delete must empty the bucket'
assert all(r['PhysicalResourceId'] == 'artifacts-artifacts' for r in responses), 'physical ID must be stable'
print(f'bootstrap ok ({len(code)} of 4096 characters, {len(responses)} responses)')
