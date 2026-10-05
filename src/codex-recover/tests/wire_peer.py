"""Synchronous WebSocket fake over stdin/stdout, independent of the client."""

import base64
import hashlib
import json
import struct
import sys


def handshake():
    headers = {}
    assert sys.stdin.buffer.readline() == b"GET / HTTP/1.1\r\n"
    while (line := sys.stdin.buffer.readline()) != b"\r\n":
        name, value = line.split(b":", 1)
        headers[name.lower()] = value.strip()
    key = headers[b"sec-websocket-key"]
    accept = base64.b64encode(
        hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11", usedforsecurity=False).digest()
    )
    sys.stdout.buffer.write(
        b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
        + accept
        + b"\r\n\r\n"
    )
    sys.stdout.buffer.flush()


def send(message):
    data = json.dumps(message).encode()
    size = len(data)
    header = bytes((0x81, size)) if size < 126 else bytes((0x81, 126)) + struct.pack("!H", size)
    sys.stdout.buffer.write(header + data)
    sys.stdout.buffer.flush()


def messages():
    handshake()
    while header := sys.stdin.buffer.read(2):
        first, second = header
        assert first == 0x81 and second & 0x80
        size = second & 127
        if size == 126:
            size = struct.unpack("!H", sys.stdin.buffer.read(2))[0]
        elif size == 127:
            size = struct.unpack("!Q", sys.stdin.buffer.read(8))[0]
        mask = sys.stdin.buffer.read(4)
        payload = sys.stdin.buffer.read(size)
        yield json.loads(bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload)))
