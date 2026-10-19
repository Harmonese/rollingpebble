import json
from pathlib import Path

import pytest

from rollingpebble.auto_timing.contracts import Options
from rollingpebble.auto_timing.protocol import EventStream, ProtocolError, plain_inventory
from rollingpebble.auto_timing.store import RunStore
from rollingpebble.storage.app_settings import SettingsStore
from test_auto_timing_v2 import event, line, finish_fixture, service_fixture


def unresolved(index=1, text="Again"):
    return dict(occurrence_id=f"input-{index}", line_id="same", input_line_index=index,
                text=text, reason="insufficient_evidence")


def ordered():
    return dict(alignment_mode="ordered", lines=[dict(line(), input_line_index=0)],
                unaligned_lines=[unresolved()])


def test_ordered_validation_and_replacement():
    stream = EventStream("test", "ordered", ["Come on", "Again"])
    stream.accept(event(1, "started"))
    stream.accept(event(2, "snapshot", revision=1, final=False, audio_available_until=1, **ordered()))
    assert len(stream.snapshot["unaligned_lines"]) == 1
    next_snapshot = dict(alignment_mode="ordered", lines=[],
                         unaligned_lines=[unresolved(0), unresolved(1)])
    stream.accept(event(3, "snapshot", revision=2, final=True, audio_available_until=2, **next_snapshot))
    assert stream.snapshot["lines"] == []
    assert len(stream.snapshot["unaligned_lines"]) == 2


@pytest.mark.parametrize("change", ["duplicate_index", "duplicate_id", "outside", "time", "mode", "missing"])
def test_invalid_ordered_snapshot(change):
    value = ordered()
    if change == "duplicate_index":
        value["unaligned_lines"][0]["input_line_index"] = 0
    elif change == "duplicate_id":
        value["unaligned_lines"][0]["occurrence_id"] = value["lines"][0]["occurrence_id"]
    elif change == "outside":
        value["unaligned_lines"][0]["input_line_index"] = 2
    elif change == "time":
        value["unaligned_lines"][0]["start"] = 0
    elif change == "mode":
        value["alignment_mode"] = "unordered"
    else:
        del value["unaligned_lines"]
    with pytest.raises(ProtocolError):
        EventStream("test", "ordered", ["a", "b"]).validate_snapshot(value)


def test_ordered_final_arrays_must_match(tmp_path):
    stream, artifacts = finish_fixture(tmp_path)
    stream.alignment_mode = "ordered"
    stream.snapshot.update(ordered())
    path = Path(artifacts["alignment"])
    result = json.loads(path.read_text())
    result.update(ordered())
    path.write_text(json.dumps(result))
    stream.finish(0, tmp_path)
    result["unaligned_lines"][0]["reason"] = "pending_audio"
    path.write_text(json.dumps(result))
    with pytest.raises(ProtocolError, match="differs"):
        stream.finish(0, tmp_path)


def test_settings_defaults_and_history(tmp_path):
    store = SettingsStore(tmp_path)
    assert Options().alignment_mode == "ordered"
    assert store.read().auto_timing_v2_options["alignment_mode"] == "ordered"
    store.path.write_text('{"auto_timing_v2_options":{"cpu_threads":8}}')
    old = store.read()
    assert old.auto_timing_v2_options == {"cpu_threads": 8, "alignment_mode": "unordered"}
    store.write(old)
    assert store.read().auto_timing_v2_options["alignment_mode"] == "unordered"
    assert store.reset_defaults().auto_timing_v2_options["alignment_mode"] == "ordered"
    assert RunStore.normalize({"options": {}})["options"]["alignment_mode"] == "unordered"


def test_fresh_layout_keeps_new_default(tmp_path):
    from rollingpebble.storage.transition import begin_layout_transition
    begin_layout_transition(tmp_path)
    assert SettingsStore(tmp_path).read().auto_timing_v2_options["alignment_mode"] == "ordered"


@pytest.mark.parametrize("mode", ["ordered", "unordered"])
def test_request_explicit_mode(tmp_path, mode):
    from rollingpebble.auto_timing.contracts import RunRequest
    service, _ = service_fixture(tmp_path)
    record, _ = service._record(RunRequest(project_id="p1", options=Options(alignment_mode=mode)))
    request = json.loads((service.store.folder(record["id"]) / "request.json").read_text())
    assert request["options"]["alignment_mode"] == mode


def test_input_keeps_repetition_order():
    assert plain_inventory("[ti:Title]\n[Chorus]\nAgain\n\nAgain\nLast") == "Again\nAgain\nLast\n"


def test_missing_input_row_is_not_silently_dropped():
    with pytest.raises(ProtocolError, match="omits"):
        EventStream("test", "ordered", ["a", "b", "c"]).validate_snapshot(ordered())


def test_all_unaligned_final_result(tmp_path):
    stream, artifacts = finish_fixture(tmp_path, [])
    stream.alignment_mode = "ordered"
    value = dict(alignment_mode="ordered", lines=[], unaligned_lines=[unresolved(0)])
    stream.snapshot.update(value)
    path = Path(artifacts["alignment"])
    result = json.loads(path.read_text())
    result.update(value)
    path.write_text(json.dumps(result))
    assert stream.finish(0, tmp_path)["unaligned_lines"] == value["unaligned_lines"]
