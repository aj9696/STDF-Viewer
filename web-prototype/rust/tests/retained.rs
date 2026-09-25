use semidata_web_parser::retained::{
    Batch, RetainedEngine, MAX_DEFINITIONS, MAX_DEFINITION_BYTES, RETAINED_CHUNK_BYTES,
};
use serde_json::{json, Value};

fn u16_bytes(value: u16, big: bool) -> [u8; 2] {
    if big {
        value.to_be_bytes()
    } else {
        value.to_le_bytes()
    }
}
fn u32_bytes(value: u32, big: bool) -> [u8; 4] {
    if big {
        value.to_be_bytes()
    } else {
        value.to_le_bytes()
    }
}
fn record(typ: u8, sub: u8, body: &[u8], big: bool) -> Vec<u8> {
    let mut bytes = u16_bytes(body.len() as u16, big).to_vec();
    bytes.extend([typ, sub]);
    bytes.extend(body);
    bytes
}
fn prefix(big: bool) -> Vec<u8> {
    let mut bytes = record(0, 10, &[if big { 1 } else { 2 }, 4], big);
    let mut mir = vec![0; 15];
    mir.extend([3, b'L', b'O', b'T']);
    bytes.extend(record(1, 10, &mir, big));
    bytes
}
fn pir(head: u8, site: u8, big: bool) -> Vec<u8> {
    record(5, 10, &[head, site], big)
}
fn prr(head: u8, site: u8, big: bool) -> Vec<u8> {
    let mut bytes = vec![head, site, 0x88];
    bytes.extend(u16_bytes(4, big));
    bytes.extend(u16_bytes(7, big));
    record(5, 20, &bytes, big)
}
fn ptr(head: u8, site: u8, flags: [u8; 2], bits: u32, tail: &[u8], big: bool) -> Vec<u8> {
    let mut body = u32_bytes(77, big).to_vec();
    body.extend([head, site, flags[0], flags[1]]);
    body.extend(u32_bytes(bits, big));
    body.extend(tail);
    record(15, 10, &body, big)
}
fn mrr(big: bool) -> Vec<u8> {
    record(1, 20, &[0; 4], big)
}
fn fixture(big: bool) -> Vec<u8> {
    let mut bytes = prefix(big);
    bytes.extend(pir(1, 2, big));
    for (flags, bits, tail) in [
        ([0, 0], 0x80000000, vec![]),
        ([0x80, 1], 0x7fc01234, vec![3, b'V', b'D', b'D']),
        ([0x40, 2], 0x7f800000, vec![]),
        ([2, 0x80], 0x3f800000, vec![0]),
    ] {
        bytes.extend(ptr(1, 2, flags, bits, &tail, big));
    }
    bytes.extend(prr(1, 2, big));
    bytes.extend(mrr(big));
    bytes
}
fn parse(bytes: &[u8], chunk: usize) -> (Value, Value) {
    let mut engine = RetainedEngine::default();
    let mut merged = Batch::default();
    for bytes in bytes.chunks(chunk) {
        let batch = engine.push(bytes).unwrap();
        merged.records.extend(batch.records);
        merged.definitions.extend(batch.definitions);
        merged.measurements.extend(batch.measurements);
        merged.devices.extend(batch.devices);
    }
    (
        serde_json::to_value(merged).unwrap(),
        serde_json::to_value(engine.finish().unwrap()).unwrap(),
    )
}
fn fails(bytes: &[u8]) -> String {
    let mut engine = RetainedEngine::default();
    for bytes in bytes.chunks(19) {
        if let Err(error) = engine.push(bytes) {
            assert!(engine.push(&[]).is_err());
            assert!(engine.finish().is_err());
            return error;
        }
    }
    engine.finish().unwrap_err()
}

#[test]
fn version_two_admits_only_flagged_orphan_ptr_defaults_and_keeps_v1_unchanged() {
    for big in [false, true] {
        let mut bytes = prefix(big);
        bytes.extend(ptr(
            1,
            2,
            [0x10, 0],
            0x7fc01234,
            &[3, b'V', b'D', b'D'],
            big,
        ));
        bytes.extend(pir(1, 2, big));
        bytes.extend(ptr(1, 2, [0, 0], 1_f32.to_bits(), &[], big));
        bytes.extend(prr(1, 2, big));
        bytes.extend(mrr(big));
        assert!(RetainedEngine::default().push(&bytes).is_err());
        for chunk in 1..bytes.len() {
            let mut engine = RetainedEngine::version_two();
            let mut rows = Batch::default();
            for part in bytes.chunks(chunk) {
                let b = engine.push(part).unwrap();
                rows.records.extend(b.records);
                rows.definitions.extend(b.definitions);
                rows.measurements.extend(b.measurements);
                rows.devices.extend(b.devices);
            }
            let summary = serde_json::to_value(engine.finish().unwrap()).unwrap();
            assert_eq!(summary["default_only_ptr"], 1);
            assert_eq!(summary["coverage"]["default_only_ptr"], 1);
            assert_eq!(summary["records"], 7);
            assert_eq!(summary["measurements"], 1);
            assert_eq!(summary["definitions"], 2);
            assert_eq!(rows.records[2].5, None);
            assert_eq!(rows.measurements[0].0, 5);
            assert_eq!(rows.measurements[0].1, 4);
            let decoded: Value = serde_json::from_str(rows.records[2].6.as_ref().unwrap()).unwrap();
            assert_eq!(
                decoded,
                json!({"DEFAULT_ONLY":true,"TEST_NUM":77,"HEAD_NUM":1,"SITE_NUM":2,"TEST_FLG":16,"PARM_FLG":0,"DEFINITION_ID":1})
            );
        }
        let ordinary = fixture(big);
        let mut v1 = RetainedEngine::default();
        let mut v2 = RetainedEngine::version_two();
        assert_eq!(
            serde_json::to_value(v1.push(&ordinary).unwrap()).unwrap(),
            serde_json::to_value(v2.push(&ordinary).unwrap()).unwrap()
        );
        let old = serde_json::to_value(v1.finish().unwrap()).unwrap();
        assert!(old.get("default_only_ptr").is_none());
        assert_eq!(
            serde_json::to_value(v2.finish().unwrap()).unwrap()["default_only_ptr"],
            0
        );
    }
}

#[test]
fn version_two_still_rejects_unexecuted_parametric_errors_or_other_orphan_families() {
    for flags in [[0, 0], [0x80, 0], [0x10, 1], [0x10, 0x80]] {
        let mut bytes = prefix(false);
        bytes.extend(ptr(1, 2, flags, 0, &[], false));
        bytes.extend(mrr(false));
        let mut engine = RetainedEngine::version_two();
        assert!(engine.push(&bytes).is_err());
        assert!(engine.finish().is_err());
    }
    let mut before_mir = record(0, 10, &[2, 4], false);
    before_mir.extend(ptr(1, 2, [0x10, 0], 0, &[], false));
    assert!(RetainedEngine::version_two().push(&before_mir).is_err());
    for (sub, body) in [(15, vec![0; 12]), (20, vec![0; 7])] {
        let mut bytes = prefix(false);
        bytes.extend(record(15, sub, &body, false));
        assert!(RetainedEngine::version_two().push(&bytes).is_err());
    }
}

#[test]
fn every_chunk_boundary_preserves_known_rows_and_exact_bits() {
    for big in [false, true] {
        let bytes = fixture(big);
        let (expected, summary) = parse(&bytes, bytes.len());
        assert_eq!(summary["byte_order"], if big { "big" } else { "little" });
        assert_eq!(summary["bytes"], bytes.len());
        assert_eq!(summary["records"], 9);
        assert_eq!(summary["measurements"], 4);
        assert_eq!(summary["definitions"], 3);
        assert_eq!(summary["devices"], 1);
        assert_eq!(
            expected["measurements"],
            json!([
                [4, 3, 1, 77, 1, 2, 0, 0, 2147483648_u32, -0.0],
                [5, 3, 2, 77, 1, 2, 128, 1, 2143294004_u32, null],
                [6, 3, 1, 77, 1, 2, 64, 2, 2139095040_u32, null],
                [7, 3, 3, 77, 1, 2, 2, 128, 1065353216_u32, 1.0],
            ])
        );
        assert_eq!(
            expected["devices"],
            json!([[3, 1, 2, 8, 136, 4, 7, 65535, -32768, -32768, 0, "", ""]])
        );
        assert!(expected["definitions"][0][2].is_null());
        assert_eq!(expected["definitions"][1][2], "VDD");
        assert_eq!(expected["definitions"][2][2], "");
        let omitted: Value =
            serde_json::from_str(expected["definitions"][0][3].as_str().unwrap()).unwrap();
        let empty: Value =
            serde_json::from_str(expected["definitions"][2][3].as_str().unwrap()).unwrap();
        assert!(omitted["TEST_TXT"].is_null());
        assert_eq!(empty["TEST_TXT"], "");
        assert_eq!(empty["RAW_TAIL_HEX"], "00");
        let mir: Value = serde_json::from_str(expected["records"][1][6].as_str().unwrap()).unwrap();
        assert_eq!(mir["LOT_ID"], "LOT");
        let mut offset = 0;
        for row in expected["records"].as_array().unwrap() {
            assert_eq!(row[1], offset);
            offset += row[2].as_u64().unwrap();
        }
        assert_eq!(offset, bytes.len() as u64);
        for chunk in 1..bytes.len() {
            let (actual, actual_summary) = parse(&bytes, chunk);
            assert_eq!(actual, expected, "chunk={chunk}, big={big}");
            assert_eq!(actual_summary, summary);
        }
    }
}

#[test]
fn simultaneous_sites_and_repeated_device_attempts_stay_separate() {
    for big in [false, true] {
        let mut bytes = prefix(big);
        bytes.extend(pir(1, 2, big)); // seq 3
        bytes.extend(pir(2, 2, big)); // seq 4
        bytes.extend(ptr(2, 2, [0, 0], 0, &[], big));
        bytes.extend(prr(2, 2, big));
        bytes.extend(prr(1, 2, big));
        bytes.extend(pir(1, 2, big)); // seq 8
        bytes.extend(ptr(1, 2, [0, 0], 0, &[], big));
        bytes.extend(prr(1, 2, big));
        bytes.extend(mrr(big));
        let (batch, summary) = parse(&bytes, 13);
        assert_eq!(batch["measurements"][0][1], 4);
        assert_eq!(batch["measurements"][1][1], 8);
        assert_eq!(summary["devices"], 3);
        assert_eq!(summary["definitions"], 1);
    }
}

#[test]
fn complete_ptr_declarations_retain_optional_presence_and_limit_bits() {
    for big in [false, true] {
        let mut tail = vec![0, 0, 0xff, 0xfd, 0xfe, 3];
        tail.extend(u32_bytes(0x7fc01234, big));
        tail.extend(u32_bytes(0x80000000, big));
        tail.extend([1, b'V', 0, 0, 0]);
        tail.extend(u32_bytes(0x7f800000, big));
        tail.extend(u32_bytes(0xff800000, big));
        let mut bytes = prefix(big);
        bytes.extend(pir(1, 2, big));
        bytes.extend(ptr(1, 2, [0, 0], 0, &tail, big));
        bytes.extend(prr(1, 2, big));
        bytes.extend(mrr(big));
        let (batch, _) = parse(&bytes, 11);
        let metadata: Value =
            serde_json::from_str(batch["definitions"][0][3].as_str().unwrap()).unwrap();
        assert_eq!(metadata["PRESENT_FIELDS"].as_array().unwrap().len(), 14);
        assert_eq!(metadata["RES_SCAL"], -3);
        assert_eq!(metadata["LO_LIMIT_BITS"], 0x7fc01234);
        assert_eq!(metadata["HI_LIMIT_BITS"], 0x80000000_u32);
        assert_eq!(metadata["LO_SPEC_BITS"], 0x7f800000);
        assert_eq!(metadata["HI_SPEC_BITS"], 0xff800000_u32);
        assert_eq!(
            metadata["RAW_TAIL_HEX"].as_str().unwrap().len(),
            tail.len() * 2
        );
    }
}

#[test]
fn finite_result_json_preserves_the_exact_f32_value_as_a_sqlite_real() {
    let mut bytes = prefix(false);
    bytes.extend(pir(1, 2, false));
    bytes.extend(ptr(1, 2, [0, 0], 0x3dcccccd, &[], false));
    bytes.extend(prr(1, 2, false));
    bytes.extend(mrr(false));
    let (batch, _) = parse(&bytes, 64);
    assert_eq!(
        batch["measurements"][0][9].as_f64(),
        Some(0.10000000149011612)
    );
}

#[test]
fn definition_count_and_byte_caps_fail_explicitly_without_growing_with_results() {
    for large in [false, true] {
        let mut engine = RetainedEngine::default();
        engine.push(&prefix(false)).unwrap();
        engine.push(&pir(1, 2, false)).unwrap();
        let mut tail = vec![];
        if large {
            for _ in 0..2 {
                tail.push(255);
                tail.extend([b'a'; 255]);
            }
            tail.extend([0; 12]);
            for _ in 0..4 {
                tail.push(255);
                tail.extend([b'b'; 255]);
            }
            tail.extend([0; 8]);
        }
        let accepted = if large {
            MAX_DEFINITION_BYTES / tail.len()
        } else {
            MAX_DEFINITIONS
        };
        for number in 0..=accepted {
            let mut bytes = ptr(1, 2, [0, 0], 0, &tail, false);
            bytes[4..8].copy_from_slice(&(number as u32).to_le_bytes());
            if number < accepted {
                engine.push(&bytes).unwrap();
            } else {
                assert!(engine
                    .push(&bytes)
                    .err()
                    .unwrap()
                    .contains("METADATA_LIMIT"));
            }
        }
        assert!(engine.push(&[]).is_err());
    }
}

#[test]
fn raw_record_families_keep_indexes_context_and_explicit_coverage() {
    let mut bytes = prefix(false);
    bytes.extend(record(180, 99, &vec![0x5a; 65535], false));
    bytes.extend(pir(1, 2, false));
    let mut mpr = vec![0; 12];
    mpr[4] = 1;
    mpr[5] = 2;
    bytes.extend(record(15, 15, &mpr, false));
    let mut ftr = vec![0; 7];
    ftr[4] = 1;
    ftr[5] = 2;
    bytes.extend(record(15, 20, &ftr, false));
    bytes.extend(prr(1, 2, false));
    bytes.extend(mrr(false));
    let (batch, summary) = parse(&bytes, RETAINED_CHUNK_BYTES);
    assert_eq!(batch["records"][2][2], 65539);
    assert!(batch["records"][2][6].is_null());
    assert_eq!(batch["records"][4][5], 4);
    assert_eq!(batch["records"][5][5], 4);
    assert_eq!(summary["measurements"], 0);
    assert_eq!(
        summary["coverage"]["indexed_only"],
        json!({"15/15":1,"15/20":1,"180/99":1})
    );
}

#[test]
fn malformed_streams_fail_closed_instead_of_publishing_partial_data() {
    let valid = fixture(false);
    for end in 0..valid.len() {
        fails(&valid[..end]);
    }
    let mut wrong_cpu = valid.clone();
    wrong_cpu[4] = 1;
    assert!(fails(&wrong_cpu).contains("IEEE"));
    let mut wrong_version = valid.clone();
    wrong_version[5] = 3;
    fails(&wrong_version);
    let mut trailing = valid.clone();
    trailing.push(0);
    assert!(fails(&trailing).contains("after final"));
    let mut duplicate_far = prefix(false);
    duplicate_far.extend(&valid[..6]);
    fails(&duplicate_far);
    let mut no_mir = valid[..6].to_vec();
    no_mir.extend(pir(1, 2, false));
    fails(&no_mir);
    let mut duplicate_mir = prefix(false);
    duplicate_mir.extend(&prefix(false)[6..]);
    fails(&duplicate_mir);
    let mut overlap = prefix(false);
    overlap.extend(pir(1, 2, false));
    overlap.extend(pir(1, 2, false));
    fails(&overlap);
    let mut unmatched = prefix(false);
    unmatched.extend(prr(1, 2, false));
    fails(&unmatched);
    let mut outside = prefix(false);
    outside.extend(ptr(1, 2, [0, 0], 0, &[], false));
    fails(&outside);
    let mut unclosed = prefix(false);
    unclosed.extend(pir(1, 2, false));
    unclosed.extend(mrr(false));
    fails(&unclosed);
    for malformed in [
        record(1, 10, &[0; 14], false),
        record(5, 10, &[1], false),
        record(5, 20, &[0; 6], false),
        record(1, 20, &[0; 3], false),
        record(15, 10, &[0; 11], false),
        record(15, 15, &[0; 11], false),
        record(15, 20, &[0; 6], false),
        ptr(1, 2, [0, 0], 0, &[3, b'V'], false),
    ] {
        let mut bytes = prefix(false);
        bytes.extend(pir(1, 2, false));
        bytes.extend(malformed);
        fails(&bytes);
    }
    let mut engine = RetainedEngine::default();
    assert!(engine.push(&vec![0; RETAINED_CHUNK_BYTES + 1]).is_err());
    assert!(engine.push(&[]).is_err());
    let mut engine = RetainedEngine::default();
    engine.push(&valid).unwrap();
    engine.finish().unwrap();
    assert!(engine.push(&[]).is_err());
    assert!(engine.finish().is_err());
}
