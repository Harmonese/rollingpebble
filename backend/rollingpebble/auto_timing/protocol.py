"""Strict public-envelope validation, deliberately independent of engine internals."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path


class ProtocolError(ValueError):
    pass


def decode(text: str):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ProtocolError("Duplicate JSON key")
            result[key] = value
        return result
    try:
        return json.loads(text, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ProtocolError("Non-finite JSON")))
    except (ValueError, TypeError) as exc:
        raise ProtocolError(f"Invalid engine JSON: {exc}") from exc


def compatible(version: object) -> bool:
    return isinstance(version, str) and bool(re.fullmatch(r"0\.10\.(?:[3-9]|[1-9][0-9]+)", version))


def number(value, *, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or (positive and value == 0):
        raise ProtocolError("Invalid engine time")
    return value


def validate_lines(lines, duration=None):
    if not isinstance(lines, list):
        raise ProtocolError("Invalid alignment lines")
    ids = set()
    for line in lines:
        if not isinstance(line, dict):
            raise ProtocolError("Invalid alignment line")
        for name in ("occurrence_id", "line_id", "text"):
            if not isinstance(line.get(name), str) or not line[name]:
                raise ProtocolError(f"Invalid {name}")
        if line["occurrence_id"] in ids:
            raise ProtocolError("Duplicate occurrence in revision")
        ids.add(line["occurrence_id"])
        start, end = number(line.get("start")), number(line.get("end"))
        if end < start or (duration is not None and end > duration + 0.001):
            raise ProtocolError("Alignment outside audio range")
        if line.get("status") not in {"tentative", "needs_review"} or type(line.get("finalized")) is not bool:
            raise ProtocolError("Invalid alignment status")
    return lines


class EventStream:
    def __init__(self, request_id: str, alignment_mode="unordered", input_lines=None, language=None):
        self.request_id = request_id
        self.alignment_mode = alignment_mode
        self.input_lines = input_lines
        self.language = language
        self.sequence = 0
        self.revision = 0
        self.started = False
        self.snapshot = None
        self.terminal = None
        self.progress = None
        self.rejected_request = None

    def validate_snapshot(self, document, duration=None):
        if self.language is not None:
            expected_backend = "wav2vec2_phoneme_ctc" if self.language == "mul" else "wav2vec2_ctc"
            if document.get("language") != self.language or document.get("timing_backend") != expected_backend:
                raise ProtocolError("Alignment language or timing backend differs from request")
        validate_lines(document.get("lines"), duration)
        mode = document.get("alignment_mode", "unordered")
        if mode != self.alignment_mode:
            raise ProtocolError("Alignment mode differs from request")
        if mode == "unordered":
            if document.get("unaligned_lines"):
                raise ProtocolError("Unexpected unordered unaligned lines")
            return
        missing = document.get("unaligned_lines")
        if not isinstance(missing, list):
            raise ProtocolError("Missing ordered unaligned lines")
        identities, indices = set(), set()
        for line in [*document["lines"], *missing]:
            if not isinstance(line, dict):
                raise ProtocolError("Invalid ordered line")
            for key in ("occurrence_id", "line_id", "text"):
                if not isinstance(line.get(key), str) or not line[key]:
                    raise ProtocolError("Invalid ordered line identity")
            index = line.get("input_line_index")
            if type(index) is not int or index < 0 or index in indices or line["occurrence_id"] in identities:
                raise ProtocolError("Duplicate or invalid ordered input index")
            if self.input_lines is not None and index >= len(self.input_lines):
                raise ProtocolError("Ordered input index outside submitted lyrics")
            indices.add(index)
            identities.add(line["occurrence_id"])
        if self.input_lines is not None and indices != set(range(len(self.input_lines))):
            raise ProtocolError("Ordered snapshot omits input lines")
        for line in missing:
            if not isinstance(line.get("reason"), str) or not line["reason"] or "start" in line or "end" in line:
                raise ProtocolError("Invalid unaligned line")

    def accept(self, raw: str):
        event = decode(raw)
        if not isinstance(event, dict) or event.get("protocol_version") != 2 or event.get("engine") != "py-roller":
            raise ProtocolError("Unsupported engine protocol")
        if not compatible(event.get("engine_version")):
            raise ProtocolError("Unsupported engine version")
        if event.get("request_id") != self.request_id:
            if not self.started and event.get("type") == "started" and self.rejected_request is None:
                self.rejected_request = event.get("request_id")
                return None
            if not self.started and event.get("type") == "failed":
                raise ProtocolError(str(event.get("message", "Engine rejected request")))
            raise ProtocolError("Engine request identity mismatch")
        seq = event.get("sequence")
        if type(seq) is not int or seq < 1:
            raise ProtocolError("Invalid event sequence")
        if seq <= self.sequence:
            return None
        if self.terminal:
            raise ProtocolError("Event after terminal")
        if seq != self.sequence + 1:
            raise ProtocolError("Missing engine event")
        self.sequence = seq
        kind = event.get("type")
        if kind == "started":
            if self.started:
                raise ProtocolError("Repeated started event")
            self.started = True
        elif kind == "progress":
            if not isinstance(event.get("stage"), str):
                raise ProtocolError("Missing progress stage")
            for key in ("duration", "audio_available_until"):
                if key in event:
                    number(event[key])
            self.progress = event
        elif kind == "snapshot":
            rev = event.get("revision")
            if type(rev) is not int or rev <= self.revision or type(event.get("final")) is not bool:
                raise ProtocolError("Invalid snapshot revision")
            number(event.get("audio_available_until"))
            self.validate_snapshot(event)
            self.revision = rev
            self.snapshot = event
        elif kind in {"completed", "failed", "cancelled"}:
            if kind == "completed":
                if not self.snapshot or not self.snapshot["final"] or type(event.get("revision")) is not int or event["revision"] != self.revision:
                    raise ProtocolError("Completed without final snapshot")
                if not all(isinstance(event.get(key), dict) for key in ("artifacts", "summary", "metrics")):
                    raise ProtocolError("Missing completion details")
            elif not all(isinstance(event.get(key), str) for key in ("code", "message")):
                raise ProtocolError("Missing failure details")
            self.terminal = event
        # Future event types are diagnostics only, never a success signal.
        if kind not in {"started", "failed"} and not self.started:
            raise ProtocolError("Event before started")
        return event

    def finish(self, return_code: int, output: Path):
        if return_code != 0 or not self.terminal or self.terminal["type"] != "completed":
            raise ProtocolError((self.terminal or {}).get("message") or f"Engine exited {return_code} without completion")
        paths = {}
        for name in ("lrc", "alignment", "diagnostics", "run", "events"):
            value = self.terminal["artifacts"].get(name)
            if not isinstance(value, str) or not Path(value).is_absolute():
                raise ProtocolError("Invalid artifact path")
            path = Path(value).resolve()
            if not path.is_relative_to(output.resolve()) or not path.is_file():
                raise ProtocolError("Missing or escaped artifact")
            paths[name] = path
        alignment = decode(paths["alignment"].read_text(encoding="utf-8"))
        if not isinstance(alignment, dict):
            raise ProtocolError("Invalid alignment document")
        if (alignment.get("protocol_version") != 2 or alignment.get("engine") != "py-roller"
                or alignment.get("request_id") != self.request_id or alignment.get("status") != "complete"
                or not compatible(alignment.get("engine_version"))):
            raise ProtocolError("Invalid alignment identity")
        duration = number(alignment.get("duration"), positive=True)
        self.validate_snapshot(alignment, duration)
        if (alignment["lines"] != self.snapshot["lines"]
                or alignment.get("unaligned_lines", []) != self.snapshot.get("unaligned_lines", [])):
            raise ProtocolError("Alignment differs from final snapshot")
        expected = []
        for line in alignment["lines"]:
            minutes, remainder = divmod(round(line["start"] * 100), 6000)
            seconds, fraction = divmod(remainder, 100)
            expected.append(f'[{minutes:02d}:{seconds:02d}.{fraction:02d}] {line["text"]}')
        if paths["lrc"].read_text(encoding="utf-8").splitlines() != expected:
            raise ProtocolError("LRC differs from final alignment")
        return alignment


def plain_inventory(text: str) -> str:
    output = []
    for raw in text.splitlines():
        # Only the input copy is normalized. Do not rewrite the editor.
        line = re.sub(r"^(?:\[\d+:\d+(?:\.\d+)?\])+", "", raw.strip()).strip()
        if not line or re.fullmatch(r"\[[^\]]*\]", line):
            continue
        if any(c.isalnum() for c in line):
            output.append(line)
    if not output:
        raise ValueError("No lyric lines to time")
    return "\n".join(output) + "\n"
