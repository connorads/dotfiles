"""One stdio connection to the installed daemon proxy; never reconnects."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Callable, Mapping
from typing import Protocol


class TransportFailure(Exception):
    """A content-free transport or RPC stop reason."""


def object_map(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise TransportFailure("invalid-protocol-object")
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TransportFailure("invalid-protocol-key")
        result[key] = item
    return result


class Peer(Protocol):
    async def request(self, method: str, params: Mapping[str, object]) -> dict[str, object]: ...


class Rpc:
    def __init__(
        self,
        process: asyncio.subprocess.Process,
        on_event: Callable[[dict[str, object]], None],
        timeout: float,
    ) -> None:
        self.process = process
        self.on_event = on_event
        self.timeout = timeout
        self.pending: dict[str, asyncio.Future[dict[str, object]]] = {}
        self._sequence = 0
        self.failure: str | None = None
        self.reader_task = asyncio.create_task(self._read())

    @classmethod
    async def open(
        cls,
        command: tuple[str, ...],
        on_event: Callable[[dict[str, object]], None],
        *,
        rpc_deadline: float = 5,
    ) -> Rpc:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=16 * 1024 * 1024,
        )
        return cls(process, on_event, rpc_deadline)

    def _fail(self, reason: str) -> None:
        if self.failure is not None:
            return
        self.failure = reason
        for future in self.pending.values():
            if not future.done():
                future.set_exception(TransportFailure(reason))
        self.on_event({"method": "recover/transportStopped", "params": {"reason": reason}})

    async def _read(self) -> None:
        assert self.process.stdout is not None
        try:
            while line := await self.process.stdout.readline():
                value: object = json.loads(line)
                message = object_map(value)
                if "method" in message:
                    self.on_event(message)
                    continue
                request_id = message.get("id")
                if not isinstance(request_id, str) or request_id not in self.pending:
                    continue
                future = self.pending[request_id]
                if future.done():
                    continue
                if "error" in message:
                    future.set_exception(TransportFailure("rpc-rejected"))
                else:
                    future.set_result(object_map(message.get("result")))
            self._fail("daemon-disconnected")
        except (ValueError, OSError, TransportFailure):
            self._fail("invalid-protocol")

    async def _write(self, message: Mapping[str, object]) -> None:
        if self.failure is not None:
            raise TransportFailure(self.failure)
        assert self.process.stdin is not None
        try:
            self.process.stdin.write(json.dumps(message, separators=(",", ":")).encode() + b"\n")
            await asyncio.wait_for(self.process.stdin.drain(), self.timeout)
        except (OSError, TimeoutError) as exc:
            self._fail("rpc-write-uncertain")
            raise TransportFailure("rpc-write-uncertain") from exc

    async def initialise(self) -> None:
        await self.request(
            "initialize",
            {
                "clientInfo": {
                    "name": "codex_recover",
                    "title": "Codex recovery worker",
                    "version": "0.1.0",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        await self._write({"method": "initialized"})

    async def request(self, method: str, params: Mapping[str, object]) -> dict[str, object]:
        self._sequence += 1
        request_id = f"recover-{self._sequence}"
        future: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            await self._write({"id": request_id, "method": method, "params": params})
            return await asyncio.wait_for(future, self.timeout)
        except TimeoutError as exc:
            self._fail("rpc-timeout")
            raise TransportFailure("rpc-timeout") from exc
        finally:
            self.pending.pop(request_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()

    async def close(self) -> None:
        self.reader_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.reader_task
        if self.process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 1)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    self.process.kill()
                await self.process.wait()
