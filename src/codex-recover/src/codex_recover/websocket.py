"""RFC 6455 client framing over the proxy's byte streams."""

import asyncio
import base64
import hashlib
import os
import struct

LIMIT = 16 * 1024 * 1024
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader = reader
        self.writer = writer

    async def connect(self) -> None:
        key = base64.b64encode(os.urandom(16)).decode()
        self.writer.write(
            (
                "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
                "Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
                f"Sec-WebSocket-Key: {key}\r\n\r\n"
            ).encode()
        )
        await self.writer.drain()
        status = await self.reader.readline()
        headers: dict[bytes, bytes] = {}
        size = len(status)
        while line := await self.reader.readline():
            size += len(line)
            if size > 8192:
                raise ValueError("oversized-handshake")
            if line == b"\r\n":
                break
            name, value = line.rstrip(b"\r\n").split(b":", 1)
            headers[name.lower()] = value.strip()
        expected = base64.b64encode(
            hashlib.sha1((key + GUID).encode(), usedforsecurity=False).digest()
        )
        if (
            status.split()[:2] != [b"HTTP/1.1", b"101"]
            or headers.get(b"upgrade", b"").lower() != b"websocket"
            or b"upgrade"
            not in [value.strip().lower() for value in headers.get(b"connection", b"").split(b",")]
            or headers.get(b"sec-websocket-accept") != expected
        ):
            raise ValueError("invalid-handshake")

    async def send(self, data: bytes, opcode: int = 1) -> None:
        if len(data) > LIMIT:
            raise ValueError("oversized-message")
        mask = os.urandom(4)
        size = len(data)
        if size < 126:
            header = bytes((0x80 | opcode, 0x80 | size))
        elif size < 65536:
            header = bytes((0x80 | opcode, 0xFE)) + struct.pack("!H", size)
        else:
            header = bytes((0x80 | opcode, 0xFF)) + struct.pack("!Q", size)
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self.writer.write(header + mask + payload)
        await self.writer.drain()

    async def receive(self) -> bytes:
        chunks = bytearray()
        started = False
        while True:
            first, second = await self.reader.readexactly(2)
            final, opcode = bool(first & 0x80), first & 15
            if first & 0x70 or second & 0x80:
                raise ValueError("invalid-frame")
            size = second & 127
            if size == 126:
                size = struct.unpack("!H", await self.reader.readexactly(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", await self.reader.readexactly(8))[0]
            if size > LIMIT or len(chunks) + size > LIMIT:
                raise ValueError("oversized-message")
            if opcode >= 8 and (not final or size > 125):
                raise ValueError("invalid-control-frame")
            payload = await self.reader.readexactly(size)
            if opcode == 8:
                raise EOFError("websocket-closed")
            if opcode == 9:
                await asyncio.wait_for(self.send(payload, 10), 5)
                continue
            if opcode == 10:
                continue
            if opcode == 1 and not started:
                started = True
            elif opcode != 0 or not started:
                raise ValueError("invalid-message")
            chunks.extend(payload)
            if final:
                return bytes(chunks)
