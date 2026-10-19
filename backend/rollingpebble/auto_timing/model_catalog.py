"""Pinned runtime files. Both providers must produce these identical SHA-256 bytes."""
from dataclasses import dataclass
from urllib.parse import urlencode


@dataclass(frozen=True)
class ModelFile:
    name: str
    size: int
    sha256: str
    inline: bytes | None = None


@dataclass(frozen=True)
class ModelSpec:
    kind: str
    revision: str
    mirror_repo: str
    mirror_revision: str
    official_repo: str
    files: tuple[ModelFile, ...]

    def url(self, file, source):
        if source == "modelscope":
            return f"https://modelscope.cn/api/v1/models/{self.mirror_repo}/repo?" + urlencode(
                {"Revision": self.mirror_revision, "FilePath": file.name})
        if self.kind == "demucs":
            return f"https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/{file.name}"
        return f"https://huggingface.co/{self.official_repo}/resolve/{self.revision}/{file.name}"


CATALOG = {
    "whisper": ModelSpec("whisper", "edaa852ec7e145841d8ffdb056a99866b5f0a478",
        "Harmonese/faster-whisper-large-v3", "3bc3b118fd346afd5a83517576568e8a60a96b86",
        "Systran/faster-whisper-large-v3", (
            ModelFile("config.json", 2394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
            ModelFile("model.bin", 3087284237, "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"),
            ModelFile("preprocessor_config.json", 340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
            ModelFile("tokenizer.json", 2480617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
            ModelFile("vocabulary.json", 1068114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
        )),
    "ctc": ModelSpec("ctc", "54074b1c16f4de6a5ad59affb4caa8f2ea03a119",
        "Harmonese/wav2vec2-large-960h-lv60-self", "8143ec44c277db1990636b1a06639f79cd776a1b",
        "facebook/wav2vec2-large-960h-lv60-self", (
            ModelFile("config.json", 1606, "bcb82b508db66c6772b34a978bcc6a411f9ea99c33cd9dee337119b5f6ddb797"),
            ModelFile("feature_extractor_config.json", 157, "5415d0e5f57a6893552b1f916d6e9b9ce312a147fff3e65b260fefadd2f77dbf"),
            ModelFile("preprocessor_config.json", 158, "c403ce09975b90dff0dd8302c42d422e9de1f166cd7772df23490069893cb0cf"),
            ModelFile("pytorch_model.bin", 1262055246, "00b604cf4d28e86559e8adaeb3a186daa89dc37f5ab216771a0a15a26db0de9f"),
            ModelFile("special_tokens_map.json", 85, "bb7068de1150661a10b55f9e4b12a0e77af8bf91f5e45e1b58afaf1d0e17f675"),
            ModelFile("tokenizer_config.json", 162, "c9a86ca4c3d72d4cda976512cd786cc65d87fe22afcd4164c8470f1dde7c9758"),
            ModelFile("vocab.json", 291, "19727f8944fe6459fc3f240ae2c198395b740f6a029bd23e06656266b83bcf64"),
        )),
    "demucs": ModelSpec("demucs", "955717e8-8726e21a", "Harmonese/demucs-htdemucs",
        "4ac73da118b4ba22e108515776d1a2d83ee89943", "", (
            ModelFile("955717e8-8726e21a.th", 84141911, "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"),
            ModelFile("htdemucs.yaml", 21, "239c445d0b14454d541ad8bd9bb271c9e536d267e8a4625208744cbb2e7bb66c",
                      b"models: ['955717e8']\n"),
        )),
}
