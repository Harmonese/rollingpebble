from __future__ import annotations

import re

# LRC metadata tags such as [ti:...], [ar:...], [al:...], [length:...], [tool:...].
# Timestamp tags start with digits and are intentionally not matched here.
_METADATA_LINE_RE = re.compile(r"^\s*\[[A-Za-z][A-Za-z0-9_-]{0,31}:[^\]]*\]\s*$")
_TIMESTAMP_TAG_RE = re.compile(r"\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]")
_LEADING_TIMESTAMP_TAGS_RE = re.compile(r"^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*")


def normalize_newlines(text: str | None) -> str:
    return (text or "").replace("\r\n", "\n").replace("\r", "\n")


def is_lrc_metadata_line(line: str) -> bool:
    stripped = line.strip()
    return bool(stripped and _METADATA_LINE_RE.match(stripped))


def strip_leading_timestamps(line: str) -> str:
    return _LEADING_TIMESTAMP_TAGS_RE.sub("", line).strip()


def strip_lrc_metadata_lines(text: str | None) -> str:
    lines: list[str] = []
    for line in normalize_newlines(text).split("\n"):
        if is_lrc_metadata_line(line):
            continue
        lines.append(line)
    return "\n".join(lines).strip("\n")


def clean_plain_lyrics(text: str | None) -> str:
    """Return actual lyric text, excluding LRC metadata and timestamp tags.

    This is used for Auto Timing input. Editor text may legitimately contain
    LRC headers, but py-roller should receive only real lyric lines.
    """
    cleaned_lines: list[str] = []
    for line in normalize_newlines(text).split("\n"):
        if is_lrc_metadata_line(line):
            continue
        lyric = strip_leading_timestamps(line)
        # If timestamps were embedded elsewhere, remove them as a safety net.
        lyric = _TIMESTAMP_TAG_RE.sub("", lyric).strip()
        if lyric:
            cleaned_lines.append(lyric)
    return "\n".join(cleaned_lines).strip()


def has_lyric_content(text: str | None) -> bool:
    return bool(clean_plain_lyrics(text).strip())
