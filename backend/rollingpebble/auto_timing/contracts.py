from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Options(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    alignment_mode: Literal["ordered", "unordered"] = "ordered"
    language: Literal["auto", "en", "zh", "zh-en", "mul"] = "auto"
    audio_mode: Literal["mix", "vocals"] = "mix"
    ctc_device: Literal["auto", "cpu", "mps"] = "auto"
    cpu_threads: int = Field(default=4, ge=1, le=256)
    previews: bool = True
    offline: bool = True
    whisper_model: str | None = None
    ctc_model: str | None = None
    ctc_zh_model: str | None = None
    ctc_mul_model: str | None = None


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str
    options: Options = Field(default_factory=Options)
    workspace_id: str = ""
    lyrics_version: str = ""
    audio_identity: str = ""
    expected_lyrics: str | None = None
    expected_audio_ref: str | None = None


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_ids: list[str] = Field(min_length=1, max_length=1000)
    options: Options = Field(default_factory=Options)


class DraftLine(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=128)
    text: str
    time: float | None = Field(default=None, ge=0)


class DraftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=0)
    base_revision: int = Field(ge=0)
    lines: list[DraftLine] | None = None


class AppliedRequest(BaseModel):
    version: int = Field(ge=0)


class ModelAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["download", "remove", "verify", "repair"]
    kind: Literal["whisper", "ctc", "ctc-zh", "ctc-mul", "demucs"] | None = None
    kinds: list[Literal["whisper", "ctc", "ctc-zh", "ctc-mul", "demucs"]] | None = Field(default=None, min_length=1, max_length=5)
    startup: bool = False
    apply: bool = False
