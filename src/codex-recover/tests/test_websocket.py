import asyncio
import struct

import pytest
from codex_recover.websocket import LIMIT, WebSocket


class Writer:
    def __init__(self):
        self.data = bytearray()

    def write(self, data):
        self.data.extend(data)

    async def drain(self):
        pass


def test_fragmented_messages_allow_interleaved_ping_and_mask_the_pong():
    async def run():
        reader = asyncio.StreamReader()
        writer = Writer()
        reader.feed_data(b'\x01\x02{"\x89\x01p\x80\x05x":1}')
        socket = WebSocket(reader, writer)
        assert await socket.receive() == b'{"x":1}'
        frame = writer.data
        assert frame[:2] == b"\x8a\x81"
        assert frame[6] ^ frame[2] == ord("p")

    asyncio.run(run())


@pytest.mark.parametrize("size", [3, 126, 65536])
def test_client_frames_use_correct_extended_lengths_and_masking(size):
    async def run():
        writer = Writer()
        await WebSocket(asyncio.StreamReader(), writer).send(b"x" * size)
        frame = writer.data
        assert frame[0] == 0x81
        assert frame[1] & 128
        offset = 2
        if size >= 65536:
            assert frame[1] & 127 == 127
            assert struct.unpack("!Q", frame[2:10])[0] == size
            offset = 10
        elif size >= 126:
            assert frame[1] & 127 == 126
            assert struct.unpack("!H", frame[2:4])[0] == size
            offset = 4
        else:
            assert frame[1] & 127 == size
        mask = frame[offset : offset + 4]
        payload = frame[offset + 4 :]
        assert bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload)) == b"x" * size

    asyncio.run(run())


@pytest.mark.parametrize(
    "frame",
    [
        b"\x82\x00",
        b"\x80\x00",
        b"\x81\x80",
        b"\x09\x00",
        b"\x81\x7f" + struct.pack("!Q", LIMIT + 1),
    ],
)
def test_invalid_or_oversized_frames_fail_without_reading_the_payload(frame):
    async def run():
        reader = asyncio.StreamReader()
        reader.feed_data(frame)
        with pytest.raises(ValueError, match=r"invalid|oversized"):
            await WebSocket(reader, Writer()).receive()

    asyncio.run(run())


def test_server_close_is_a_disconnect():
    async def run():
        reader = asyncio.StreamReader()
        reader.feed_data(b"\x88\x00")
        with pytest.raises(EOFError, match="websocket-closed"):
            await WebSocket(reader, Writer()).receive()

    asyncio.run(run())
