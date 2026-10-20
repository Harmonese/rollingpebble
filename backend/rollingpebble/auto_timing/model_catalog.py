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
    "ctc-zh": ModelSpec("ctc-zh", "99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd",
        "Harmonese/wav2vec2-large-xlsr-53-chinese-zh-cn", "97fab8015161125b0450cbb94343082f155d1854",
        "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn", (
            ModelFile("config.json", 1567, "9af98614e322a5300c75605227d93c98af0c8f78754aba1dfc279166688afddd"),
            ModelFile("preprocessor_config.json", 158, "c403ce09975b90dff0dd8302c42d422e9de1f166cd7772df23490069893cb0cf"),
            ModelFile("pytorch_model.bin", 1276296151, "de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4"),
            ModelFile("special_tokens_map.json", 85, "bb7068de1150661a10b55f9e4b12a0e77af8bf91f5e45e1b58afaf1d0e17f675"),
            ModelFile("vocab.json", 44357, "33fea3444869c2cd2433f59da079b04ce91515f946d21fe1b0ff3825398bcec7"),
        )),
    "ctc-mul": ModelSpec("ctc-mul", "2c733782da5604684829819a5eb744c193fe9398",
        "Harmonese/wav2vec2-xlsr-53-espeak-cv-ft", "ebe2981058623bf988eadb2a6e140b4f305c018f",
        "facebook/wav2vec2-xlsr-53-espeak-cv-ft", (
            ModelFile("config.json", 1856, "4609fb49b7e1d28aecb2840da1926c40bd915bc6f1120a940afacf7159bbfb13"),
            ModelFile("preprocessor_config.json", 212, "a2254a5b58f72cd4de3632f8eee64f3f098b7c1402128d2f419e7d00ae13e335"),
            ModelFile("pytorch_model.bin", 1263535127, "04366b6c8d24099ef313cf02f0e58d26f5dddfda16edbfc8eb2c713d94a9f551"),
            ModelFile("special_tokens_map.json", 85, "bb7068de1150661a10b55f9e4b12a0e77af8bf91f5e45e1b58afaf1d0e17f675"),
            ModelFile("tokenizer_config.json", 412, "d663833dacef7d29f563e23029d448fe41415dbe5e8e6d5a98b598a5258c18d8"),
            ModelFile("vocab.json", 4637, "d732ab2456c0c017930001dc9af0b41b3b93d25b2eb9740bf9d925508d7d87d0"),
        )),
}
