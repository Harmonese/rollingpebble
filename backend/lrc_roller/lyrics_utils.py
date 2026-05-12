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




def leading_lrc_metadata_block(text: str | None) -> list[str]:
    """Return the original leading LRC metadata lines, preserving order/text.

    Only the contiguous header block before the first non-empty non-metadata
    line is preserved. This lets lrc-roller keep user/editor metadata such as
    [ti:...], [ar:...], [al:...] when replacing the timed lyric body with an
    automatic timing result.
    """
    headers: list[str] = []
    for line in normalize_newlines(text).split("\n"):
        if not line.strip():
            # Ignore blank padding before/inside the header block, but do not
            # emit it into the preserved header list.
            continue
        if is_lrc_metadata_line(line):
            headers.append(line.rstrip())
            continue
        break
    return headers


def strip_all_lrc_metadata_lines(text: str | None) -> str:
    """Remove all LRC metadata tag lines while keeping timed lyric lines."""
    lines: list[str] = []
    for line in normalize_newlines(text).split("\n"):
        if is_lrc_metadata_line(line):
            continue
        lines.append(line)
    return "\n".join(lines).strip("\n")


def merge_lrc_metadata_header(original_text: str | None, generated_lrc: str | None) -> str:
    """Prefix generated LRC with the original editor metadata header block.

    py-roller may output its own metadata such as [by: py-roller]. When the
    generated result is written back into a project/editor, lrc-roller should
    preserve the user's original leading metadata instead of replacing it.
    """
    headers = leading_lrc_metadata_block(original_text)
    body = strip_all_lrc_metadata_lines(generated_lrc).strip()
    if headers and body:
        return "\n".join(headers + [body]).strip()
    if headers:
        return "\n".join(headers).strip()
    return normalize_newlines(generated_lrc).strip()

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
