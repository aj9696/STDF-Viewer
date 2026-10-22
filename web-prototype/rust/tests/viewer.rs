use semidata_web_parser::viewer::{
    decode_record_native, ViewerBatch, ViewerEngine, MAX_BATCH_BYTES, MAX_BATCH_ROWS,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashSet, VecDeque};

fn u16b(n: u16, big: bool) -> [u8; 2] {
    if big {
        n.to_be_bytes()
    } else {
        n.to_le_bytes()
    }
}
fn u32b(n: u32, big: bool) -> [u8; 4] {
    if big {
        n.to_be_bytes()
    } else {
        n.to_le_bytes()
    }
}
fn rec(typ: u8, sub: u8, body: &[u8], big: bool) -> Vec<u8> {
    assert!(body.len() <= 65535);
    let mut r = u16b(body.len() as u16, big).to_vec();
    r.extend([typ, sub]);
    r.extend(body);
    r
}
fn cn(s: &str) -> Vec<u8> {
    assert!(s.len() < 256);
    let mut r = vec![s.len() as u8];
    r.extend(s.as_bytes());
    r
}
fn start(big: bool) -> Vec<u8> {
    let mut r = rec(0, 10, &[if big { 1 } else { 2 }, 4], big);
    r.extend(rec(1, 10, &[0; 15], big));
    r
}
fn pir(h: u8, s: u8, big: bool) -> Vec<u8> {
    rec(5, 10, &[h, s], big)
}
fn prr(h: u8, s: u8, flags: u8, big: bool) -> Vec<u8> {
    let mut b = vec![h, s, flags];
    b.extend(u16b(7, big));
    b.extend(u16b(2, big));
    b.extend(u16b(3, big));
    b.extend(u16b(12, big));
    b.extend(u16b(0x8000, big));
    b.extend(u32b(123, big));
    b.extend(cn("DUPLICATE"));
    b.extend(cn("part"));
    rec(5, 20, &b, big)
}
fn finish(big: bool) -> Vec<u8> {
    rec(1, 20, &[0; 4], big)
}
fn ptr(num: u32, bits: u32, tail: &[u8], flags: u8, big: bool) -> Vec<u8> {
    let mut b = u32b(num, big).to_vec();
    b.extend([1, 2, flags, 0]);
    b.extend(u32b(bits, big));
    b.extend(tail);
    rec(15, 10, &b, big)
}
fn tail(
    name: &str,
    opt: u8,
    scales: [i8; 3],
    low: f32,
    high: f32,
    unit: &str,
    big: bool,
) -> Vec<u8> {
    let mut t = cn(name);
    t.extend([0, opt, scales[0] as u8, scales[1] as u8, scales[2] as u8]);
    t.extend(u32b(low.to_bits(), big));
    t.extend(u32b(high.to_bits(), big));
    t.extend(cn(unit));
    t.extend([0, 0, 0]);
    t.extend(u32b((-2_f32).to_bits(), big));
    t.extend(u32b(2_f32.to_bits(), big));
    t
}
fn mpr(count: usize, big: bool) -> Vec<u8> {
    let mut b = u32b(8, big).to_vec();
    b.extend([1, 2, 0x80, 0x40]);
    b.extend(u16b(3, big));
    b.extend(u16b(count as u16, big));
    b.extend([0x21, 0x03]);
    for i in 0..count {
        b.extend(u32b(
            if i == 0 {
                0x7fc01234
            } else {
                (i as f32).to_bits()
            },
            big,
        ));
    }
    b.extend(cn("MULTI"));
    b.extend([0, 0, 6, 3, 9]);
    b.extend(u32b(0_f32.to_bits(), big));
    b.extend(u32b(5_f32.to_bits(), big));
    b.extend(u32b(1_f32.to_bits(), big));
    b.extend(u32b(0.5_f32.to_bits(), big));
    for p in [20, 21, 22] {
        b.extend(u16b(p, big));
    }
    b.extend(cn("AMPS"));
    b.extend(cn("VOLTS"));
    rec(15, 15, &b, big)
}
fn ftr(big: bool) -> Vec<u8> {
    let mut b = u32b(9, big).to_vec();
    b.extend([1, 2, 0x80, 0]);
    for n in [100_u32, 200, 3, 2, 5, 6] {
        b.extend(u32b(n, big));
    }
    b.extend(u16b(7, big));
    b.extend(u16b(2, big));
    b.extend(u16b(1, big));
    for p in [20, 22] {
        b.extend(u16b(p, big));
    }
    b.push(0x54);
    b.extend(u16b(21, big));
    b.push(6);
    b.extend(u16b(3, big));
    b.push(5);
    b.extend(cn("PATTERN_A"));
    b.extend(cn("TS"));
    b.extend(cn("OP"));
    b.extend(cn("SCAN"));
    rec(15, 20, &b, big)
}
fn add(all: &mut ViewerBatch, b: ViewerBatch) {
    let row_count = b.tests.len()
        + b.observations.len()
        + b.pin_states.len()
        + b.devices.len()
        + b.metadata.len();
    assert!(row_count <= MAX_BATCH_ROWS);
    assert!(serde_json::to_vec(&b).unwrap().len() <= MAX_BATCH_BYTES);
    all.tests.extend(b.tests);
    all.observations.extend(b.observations);
    all.pin_states.extend(b.pin_states);
    all.devices.extend(b.devices);
    all.metadata.extend(b.metadata);
}
fn parse(bytes: &[u8], chunk: usize) -> (Value, Value) {
    let mut e = ViewerEngine::default();
    let mut all = ViewerBatch::default();
    for c in bytes.chunks(chunk) {
        let mut b = e.push(c).unwrap();
        loop {
            let pending = b.pending;
            add(&mut all, b);
            if !pending {
                break;
            }
            b = e.drain().unwrap();
        }
    }
    (serde_json::to_value(all).unwrap(), e.finish().unwrap())
}
fn one_device(records: &[Vec<u8>], big: bool) -> Vec<u8> {
    let mut b = start(big);
    b.extend(pir(1, 2, big));
    for r in records {
        b.extend(r);
    }
    b.extend(prr(1, 2, 0, big));
    b.extend(finish(big));
    b
}

#[derive(Debug, PartialEq)]
struct StreamAudit {
    hashes: Vec<Vec<u8>>,
    summary: Value,
    declarations: usize,
    declaration_json_bytes: usize,
    first_default: Value,
    last_observations: Vec<Value>,
}

// Audit large streams without retaining their emitted declaration history.
fn audit_stream(bytes: &[u8], chunk: usize) -> Result<StreamAudit, String> {
    let mut engine = ViewerEngine::default();
    let mut hashes: [Sha256; 5] = std::array::from_fn(|_| Sha256::new());
    let mut metadata_ids = HashSet::new();
    let mut declarations = 0;
    let mut declaration_json_bytes = 0;
    let mut first_default = Value::Null;
    let mut last_observations = VecDeque::new();
    fn hash_rows<T: serde::Serialize>(hash: &mut Sha256, rows: &[T]) {
        for row in rows {
            hash.update(serde_json::to_vec(row).unwrap());
            hash.update(b"\n");
        }
    }
    for input in bytes.chunks(chunk) {
        let mut batch = engine.push(input)?;
        loop {
            let rows = batch.tests.len()
                + batch.observations.len()
                + batch.devices.len()
                + batch.pin_states.len()
                + batch.metadata.len();
            assert!(rows <= MAX_BATCH_ROWS);
            if rows != 0 {
                assert!(serde_json::to_vec(&batch).unwrap().len() <= MAX_BATCH_BYTES);
            }
            hash_rows(&mut hashes[0], &batch.tests);
            hash_rows(&mut hashes[1], &batch.observations);
            hash_rows(&mut hashes[2], &batch.devices);
            hash_rows(&mut hashes[3], &batch.pin_states);
            hash_rows(&mut hashes[4], &batch.metadata);
            if first_default.is_null() {
                if let Some(row) = batch.tests.first() {
                    first_default = serde_json::from_str(&row.5).unwrap();
                }
            }
            for row in &batch.metadata {
                assert!(metadata_ids.insert(row.0), "metadata IDs remain unique");
                if row.2 == 15 {
                    declarations += 1;
                    declaration_json_bytes += row.5.len();
                }
            }
            for row in &batch.observations {
                assert!(
                    metadata_ids.contains(&row.13),
                    "observation references an emitted declaration"
                );
                last_observations.push_back(serde_json::to_value(row).unwrap());
                if last_observations.len() > 8 {
                    last_observations.pop_front();
                }
            }
            if !batch.pending {
                break;
            }
            batch = engine.drain()?;
        }
    }
    Ok(StreamAudit {
        hashes: hashes
            .into_iter()
            .map(|hash| hash.finalize().to_vec())
            .collect(),
        summary: engine.finish()?,
        declarations,
        declaration_json_bytes,
        first_default,
        last_observations: last_observations.into_iter().collect(),
    })
}

#[test]
fn streamed_declaration_json_is_not_retained_state() {
    for big in [false, true] {
        let mut bytes = start(big);
        bytes.extend(pir(1, 2, big));
        for i in 0..2500 {
            let mut t = cn("DYNAMIC");
            t.extend(cn(&format!("{i:05}{}", "A".repeat(220))));
            t.extend([0, 0, 0, 0]);
            t.extend(u32b(0_f32.to_bits(), big));
            t.extend(u32b(2_f32.to_bits(), big));
            t.extend(cn("V"));
            for _ in 0..3 {
                t.extend(cn(&"F".repeat(250)));
            }
            bytes.extend(ptr(7, 1_f32.to_bits(), &t, 0, big));
        }
        bytes.extend(prr(1, 2, 0, big));
        bytes.extend(finish(big));
        let result = audit_stream(&bytes, 65536).unwrap();
        assert_eq!(result.summary["tests"], 1);
        assert_eq!(result.summary["observations"], 2500);
        assert_eq!(result.declarations, 2500);
        // The old accounting rejected this emitted JSON even though it was no
        // longer held by the parser after each bounded batch was consumed.
        assert!(result.declaration_json_bytes * 2 > 16 * 1024 * 1024);
        assert_eq!(result.last_observations.last().unwrap()[12], 2.);
    }
}

#[test]
fn declaration_cache_rotation_preserves_first_defaults_and_chunk_determinism() {
    for big in [false, true] {
        let initial = tail("OVERRIDES", 0, [6, 3, 9], -1., 2., "V", big);
        let mut bytes = start(big);
        bytes.extend(pir(1, 2, big));
        bytes.extend(ptr(7, 1_f32.to_bits(), &initial, 0, big));
        for i in 1..=20000 {
            bytes.extend(ptr(
                7,
                1_f32.to_bits(),
                &tail("OVERRIDES", 0, [0, 0, 0], i as f32, i as f32 + 1., "V", big),
                0,
                big,
            ));
        }
        // The first exact key has been evicted and needs a fresh metadata ID.
        bytes.extend(ptr(7, 1_f32.to_bits(), &initial, 0, big));
        bytes.extend(ptr(7, 1_f32.to_bits(), &initial, 0, big));
        bytes.extend(ptr(
            7,
            1_f32.to_bits(),
            &tail("OVERRIDES", 0xc0, [0, 0, 0], 8., 9., "\0", big),
            0,
            big,
        ));
        bytes.extend(ptr(7, 1_f32.to_bits(), &[], 0, big));
        bytes.extend(prr(1, 2, 0, big));
        bytes.extend(finish(big));
        let expected = audit_stream(&bytes, 65536).unwrap();
        assert_eq!(expected.summary["tests"], 1);
        assert_eq!(expected.summary["observations"], 20005);
        assert_eq!(expected.declarations, 20004);
        assert_eq!(expected.first_default["effective"]["scale"], 6);
        let last = &expected.last_observations;
        let repeated = &last[last.len() - 4];
        assert_eq!(
            repeated[0], repeated[13],
            "evicted declaration receives the current sequence ID"
        );
        assert_eq!(
            last[last.len() - 3][13],
            repeated[13],
            "resident exact key is still deduplicated"
        );
        assert!(last[last.len() - 2][11].is_null());
        assert!(last[last.len() - 2][12].is_null());
        assert_eq!(last[last.len() - 2][14], "");
        assert_eq!(last.last().unwrap()[11], -1.);
        assert_eq!(last.last().unwrap()[12], 2.);
        assert_eq!(last.last().unwrap()[14], "V");
        for chunk in [1, 17] {
            assert_eq!(
                audit_stream(&bytes, chunk).unwrap(),
                expected,
                "chunk {chunk}"
            );
        }
    }
}

fn large_initial_sections(tests: usize, repeats: usize, big: bool) -> Vec<u8> {
    let mut bytes = start(big);
    bytes.extend(pir(1, 2, big));
    for _ in 0..256 {
        bytes.extend(rec(20, 10, &cn(&"S".repeat(255)), big));
    }
    for i in 0..tests {
        bytes.extend(ptr(
            1000 + i as u32,
            1_f32.to_bits(),
            &tail(&format!("D{i:03}"), 0, [0, 0, 0], 0., 2., "V", big),
            0,
            big,
        ));
    }
    for _ in 0..repeats {
        bytes.extend(ptr(
            1000 + tests as u32 - 1,
            1_f32.to_bits(),
            &tail(
                &format!("D{:03}", tests - 1),
                0,
                [0, 0, 0],
                0.,
                2.,
                "V",
                big,
            ),
            0,
            big,
        ));
    }
    for _ in 0..256 {
        bytes.extend(rec(20, 20, &[], big));
    }
    bytes.extend(prr(1, 2, 0, big));
    bytes.extend(finish(big));
    bytes
}

#[test]
fn durable_defaults_remain_bounded_and_uncacheable_records_can_stream() {
    for big in [false, true] {
        // A 65,535-byte initial section per test nearly fills durable state.
        // The last declaration cannot fit alongside it, but can still stream.
        let result = audit_stream(&large_initial_sections(254, 2, big), 65536).unwrap();
        assert_eq!(result.summary["tests"], 254);
        assert_eq!(result.summary["observations"], 256);
        assert_eq!(result.declarations, 256);
        for row in result.last_observations.iter().rev().take(3) {
            assert_eq!(
                row[0], row[13],
                "uncached exact repetitions emit fresh metadata IDs"
            );
            assert_eq!(row[12], 2.);
        }
        let error = audit_stream(&large_initial_sections(255, 0, big), 65536).unwrap_err();
        assert!(
            error.contains("initial viewer test definitions exceed 16 MiB"),
            "{error}"
        );
    }
}

#[test]
fn declaration_rotation_does_not_remove_the_test_identity_limit() {
    let mut bytes = start(false);
    bytes.extend(pir(1, 2, false));
    for number in 0..=20000 {
        bytes.extend(ptr(number, 1_f32.to_bits(), &cn("A"), 0, false));
    }
    bytes.extend(prr(1, 2, 0, false));
    bytes.extend(finish(false));
    let error = audit_stream(&bytes, 65536).unwrap_err();
    assert!(
        error.contains("more than 20,000 test identities"),
        "{error}"
    );
}

#[test]
fn endian_and_every_chunk_boundary_preserve_base_units_and_overrides() {
    for big in [false, true] {
        let r = one_device(
            &[
                ptr(
                    7,
                    1_f32.to_bits(),
                    &tail("CURRENT", 0, [6, 3, 9], 0., 2., "AMPS", big),
                    0,
                    big,
                ),
                ptr(
                    7,
                    1_f32.to_bits(),
                    &tail("CURRENT", 0, [3, 6, 0], 0.5, 1.5, "AMPS", big),
                    0,
                    big,
                ),
                ptr(7, 0x80000000, &[], 0, big),
            ],
            big,
        );
        let (all, summary) = parse(&r, r.len());
        assert_eq!(summary["records"], 8);
        assert_eq!(summary["tests"], 1);
        assert_eq!(summary["observations"], 3);
        assert_eq!(summary["byteOrder"], if big { "big" } else { "little" });
        assert_eq!(
            all["observations"][0],
            json!([4, 0, 3, 1, 1, 2, 0, 0, 1065353216, 1., 1., 0., 2., 4, "AMPS", null])
        );
        assert_eq!(all["observations"][1][11], 0.5);
        assert_eq!(all["observations"][1][12], 1.5);
        assert_eq!(all["observations"][2][11], 0.);
        assert_eq!(all["observations"][2][12], 2.);
        assert_eq!(all["observations"][2][8], 0x80000000_u32);
        let meta: Value = serde_json::from_str(all["tests"][0][5].as_str().unwrap()).unwrap();
        assert_eq!(meta["effective"]["scale"], 6);
        assert_eq!(meta["effective"]["lowScale"], 3);
        assert_eq!(meta["effective"]["highScale"], 9);
        assert_eq!(meta["effective"]["lowSpec"], -2.);
        for chunk in 1..r.len() {
            assert_eq!(
                parse(&r, chunk),
                (all.clone(), summary.clone()),
                "chunk {chunk}"
            );
        }
    }
}
#[test]
fn flags_distinguish_inherited_and_absent_limits() {
    let big = false;
    let r = one_device(
        &[
            ptr(7, 0, &tail("A", 0, [6, 3, 9], -1., 2., "V", big), 0, big),
            ptr(7, 0, &tail("A", 0x31, [0, 0, 0], 8., 9., "", big), 0, big),
            ptr(7, 0, &tail("A", 0xc0, [0, 0, 0], 8., 9., "\0", big), 0, big),
            ptr(7, 0, &[], 0, big),
            ptr(
                7,
                0x7f800000,
                &tail("A", 0, [0, 0, 0], f32::NAN, 9., "V", big),
                2,
                big,
            ),
        ],
        big,
    );
    let (a, _) = parse(&r, 17);
    assert_eq!(a["observations"][1][11], -1.);
    assert_eq!(a["observations"][1][12], 2.);
    assert!(a["observations"][2][11].is_null());
    assert!(a["observations"][2][12].is_null());
    assert_eq!(a["observations"][2][14], "");
    assert_eq!(a["observations"][3][14], "V");
    assert_eq!(a["observations"][3][12], 2.);
    assert!(a["observations"][4][9].is_null());
    assert!(a["observations"][4][11].is_null());
    assert_eq!(a["observations"][4][8], 0x7f800000_u32);
}
#[test]
fn ambiguous_and_empty_names_do_not_merge_or_fail() {
    let r = one_device(
        &[
            ptr(7, 0, &cn("A"), 0, false),
            ptr(7, 0, &[], 0, false),
            ptr(7, 0, &cn("B"), 0, false),
            ptr(7, 0, &[], 0, false),
            ptr(7, 0, &cn(""), 0, false),
            ptr(7, 0, &[], 0, false),
        ],
        false,
    );
    let (a, s) = parse(&r, 13);
    assert_eq!(s["tests"], 4);
    assert_eq!(a["observations"][0][3], a["observations"][1][3]);
    assert_eq!(a["observations"][3][3], a["observations"][5][3]);
    assert_ne!(a["observations"][3][3], a["observations"][4][3]);
    assert_eq!(a["tests"][3][3], "");
    assert_eq!(s["warnings"].as_array().unwrap().len(), 1);
}
#[test]
fn mpr_and_ftr_arrays_keep_independent_ordinals_exact_bits_and_flags() {
    for big in [false, true] {
        let r = one_device(&[mpr(3, big), mpr(4, big), ftr(big)], big);
        let (a, s) = parse(&r, 1);
        assert_eq!(s["observations"], 8);
        assert_eq!(s["tests"], 2);
        assert_eq!(
            a["observations"][0],
            json!([
                4,
                0,
                3,
                1,
                1,
                2,
                128,
                64,
                0x7fc01234_u32,
                null,
                null,
                0.,
                5.,
                4,
                "AMPS",
                20
            ])
        );
        assert_eq!(a["observations"][2][15], 22);
        assert!(a["observations"][3][15].is_null());
        assert_eq!(a["pinStates"][0], json!([4, "RTN", 0, 20, 1]));
        assert_eq!(a["pinStates"][2], json!([4, "RTN", 2, 22, 3]));
        assert_eq!(a["pinStates"][6], json!([6, "RTN", 0, 20, 4]));
        assert_eq!(a["pinStates"][8], json!([6, "PGM", 0, 21, 6]));
        assert!(a["observations"][7][8].is_null());
        assert!(a["observations"][7][7].is_null());
        let metadata: Value = serde_json::from_str(a["tests"][1][5].as_str().unwrap()).unwrap();
        assert_eq!(metadata["effective"]["pattern"], "PATTERN_A");
    }
}
#[test]
fn one_large_record_drains_under_row_and_byte_budgets() {
    let r = one_device(&[mpr(12000, false)], false);
    let mut e = ViewerEngine::default();
    let mut b = e.push(&r).unwrap();
    let mut all = ViewerBatch::default();
    let mut batches = 0;
    assert!(b.pending);
    assert!(e.push(&[]).is_err());
    assert!(e.finish().is_err());
    loop {
        batches += 1;
        let p = b.pending;
        add(&mut all, b);
        if !p {
            break;
        }
        b = e.drain().unwrap();
    }
    assert!(batches >= 6);
    assert_eq!(all.observations.len(), 12000);
    assert_eq!(e.finish().unwrap()["observations"], 12000);
}
#[test]
fn zero_result_mpr_and_minimal_ftr_keep_execution_rows() {
    let mut f = u32b(8, false).to_vec();
    f.extend([1, 2, 0]);
    let r = one_device(&[mpr(0, false), rec(15, 20, &f, false)], false);
    let (a, s) = parse(&r, 29);
    assert_eq!(s["observations"], 2);
    assert_ne!(a["observations"][0][3], a["observations"][1][3]);
    assert!(a["observations"][0][8].is_null());
    assert!(a["observations"][1][8].is_null());
}
#[test]
fn defaults_only_ptr_and_wafer_at_pir_preserve_context() {
    let mut r = start(false);
    r.extend(ptr(
        7,
        0,
        &tail("A", 0, [0, 0, 0], 0., 2., "V", false),
        0x10,
        false,
    ));
    let mut w = vec![1, 1];
    w.extend([0; 4]);
    w.extend(cn("WAFER"));
    r.extend(rec(2, 10, &w, false));
    r.extend(pir(1, 2, false));
    r.extend(pir(2, 3, false));
    r.extend(ptr(7, 1_f32.to_bits(), &[], 0, false));
    r.extend(rec(50, 30, &cn("hello"), false));
    r.extend(prr(1, 2, 1, false));
    r.extend(prr(2, 3, 0, false));
    r.extend(finish(false));
    let (a, s) = parse(&r, 7);
    assert_eq!(s["observations"], 1);
    assert_eq!(a["devices"][0][13], 4);
    assert!(a["devices"][1][13].is_null());
    assert_eq!(a["devices"][0][4], 1);
    assert_eq!(a["devices"][0][9], -32768);
    let log = a["metadata"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x[2] == 50 && x[3] == 30)
        .unwrap();
    let decoded: Value = serde_json::from_str(log[5].as_str().unwrap()).unwrap();
    assert_eq!(decoded["VIEWER_ACTIVE_DEVICES"], json!([5, 6]));
}
#[test]
fn cold_metadata_sections_typed_gdr_and_unknown_inspection() {
    let mut r = start(false);
    r.extend(rec(20, 10, &cn("SECTION"), false));
    r.extend(pir(1, 2, false));
    r.extend(ptr(7, 0, &cn("A"), 0, false));
    r.extend(rec(50, 10, &[1, 0, 1, 7], false));
    r.extend(rec(20, 20, &[], false));
    r.extend(prr(1, 2, 0, false));
    r.extend(finish(false));
    let (a, _) = parse(&r, 23);
    let m: Value = serde_json::from_str(a["tests"][0][5].as_str().unwrap()).unwrap();
    assert_eq!(m["effective"]["section"], "SECTION");
    let g = decode_record_native(&rec(50, 10, &[1, 0, 1, 7], false), "little").unwrap();
    assert!(g.contains("U1"));
    assert!(g.contains("7"));
    let u: Value = serde_json::from_str(
        &decode_record_native(&rec(99, 7, &[1, 2, 3], false), "little").unwrap(),
    )
    .unwrap();
    assert_eq!(u["name"], "UNKNOWN");
    assert_eq!(u["fields"]["RAW_HEX"], "010203");
    assert!(decode_record_native(&[0; 3], "little").is_err());
    assert!(decode_record_native(&rec(50, 30, &cn("x"), false), "LE").is_err());
}
#[test]
fn malformed_streams_and_arrays_fail_without_silent_defaults() {
    for bad in [
        vec![0; 5],
        one_device(&[rec(15, 15, &[0; 11], false)], false),
        one_device(&[ptr(7, 0, &[3, b'x'], 0, false)], false),
    ] {
        let mut e = ViewerEngine::default();
        let result = e.push(&bad);
        if result.is_ok() {
            assert!(e.finish().is_err());
        } else {
            assert!(e.push(&[]).is_err());
        }
    }
    let mut r = start(false);
    r.extend(pir(1, 2, false));
    r.extend(finish(false));
    assert!(ViewerEngine::default().push(&r).is_err());
    let mut r = one_device(&[], false);
    r.push(0);
    let mut e = ViewerEngine::default();
    e.push(&r).unwrap();
    assert!(e.finish().is_err());
    let mut f = ftr(false);
    f.pop();
    let length = (f.len() - 4) as u16;
    f[0..2].copy_from_slice(&length.to_le_bytes());
    assert!(ViewerEngine::default()
        .push(&one_device(&[f], false))
        .is_err());
}

/// Independent bytes/expected counts for browser integration; opt in with a destination.
#[test]
#[ignore]
fn write_browser_fixtures() {
    let dir = std::env::var("VIEWER_FIXTURE_DIR").expect("Set VIEWER_FIXTURE_DIR");
    std::fs::create_dir_all(&dir).unwrap();
    for big in [false, true] {
        let mut defaults = start(big);
        defaults.extend(ptr(
            7,
            0,
            &tail("DEFAULTS", 0, [6, 3, 9], 0., 2., "AMPS", big),
            0x10,
            big,
        ));
        defaults.extend(pir(1, 2, big));
        defaults.extend(ptr(7, 1_f32.to_bits(), &[], 0, big));
        defaults.extend(prr(1, 2, 0, big));
        defaults.extend(finish(big));
        let defaults_name = if big {
            "defaults-only-big.stdf"
        } else {
            "defaults-only-little.stdf"
        };
        std::fs::write(std::path::Path::new(&dir).join(defaults_name), &defaults).unwrap();
        std::fs::write(std::path::Path::new(&dir).join(defaults_name.replace(".stdf",".expected.json")),
            serde_json::to_string_pretty(&json!({"file":defaults_name,"bytes":defaults.len(),"records":7,"defaultOnlyPtr":1,
                "measurements":1,"definitions":2,"devices":1,"observations":1,"tests":1,"deviceIds":[4],"observationSeqs":[5]})).unwrap()).unwrap();
        let mut r = start(big);
        let mut pcr = vec![1, 2];
        for n in [2_u32, 1, 0, 1, 1] {
            pcr.extend(u32b(n, big));
        }
        r.extend(rec(1, 30, &pcr, big));
        for sub in [40, 50] {
            let mut b = vec![1, 2];
            b.extend(u16b(if sub == 40 { 2 } else { 3 }, big));
            b.extend(u32b(2, big));
            b.push(b'P');
            b.extend(cn("PASS_BIN"));
            r.extend(rec(1, sub, &b, big));
        }
        for index in [20_u16, 21, 22] {
            let mut p = u16b(index, big).to_vec();
            p.extend(u16b(1, big));
            p.extend(cn(&format!("CH{index}")));
            p.extend(cn(&format!("P{index}")));
            p.extend(cn(&format!("LOG{index}")));
            p.extend([1, 2]);
            r.extend(rec(1, 60, &p, big));
        }
        let mut p = u16b(100, big).to_vec();
        p.extend(cn("BUS"));
        p.extend(u16b(3, big));
        for n in [20, 21, 22] {
            p.extend(u16b(n, big));
        }
        r.extend(rec(1, 62, &p, big));
        let mut p = u16b(1, big).to_vec();
        p.extend(u16b(100, big));
        p.extend(u16b(20, big));
        p.push(2);
        for s in ["LH", "01", "hl", "01"] {
            p.extend(cn(s));
        }
        r.extend(rec(1, 63, &p, big));
        let mut p = u16b(1, big).to_vec();
        p.extend(u16b(2, big));
        r.extend(rec(1, 70, &p, big));
        r.extend(rec(1, 80, &[1, 1, 1, 2], big));
        let mut w = vec![];
        for f in [200_f32, 1., 1.] {
            w.extend(u32b(f.to_bits(), big));
        }
        w.extend([3, b'D']);
        w.extend(u16b(0, big));
        w.extend(u16b(0, big));
        w.extend([b'R', b'U']);
        r.extend(rec(2, 30, &w, big));
        let mut w = vec![1, 1];
        w.extend(u32b(100, big));
        w.extend(cn("WAFER_A"));
        r.extend(rec(2, 10, &w, big));
        r.extend(rec(20, 10, &cn("MAIN"), big));
        r.extend(pir(1, 2, big));
        r.extend(ptr(
            7,
            1_f32.to_bits(),
            &tail("CURRENT", 0, [6, 3, 9], 0., 2., "AMPS", big),
            0,
            big,
        ));
        r.extend(ptr(7, 0x80000000, &[], 0, big));
        r.extend(ptr(
            7,
            2_f32.to_bits(),
            &tail("CURRENT", 0, [3, 6, 0], 0.5, 1.5, "AMPS", big),
            0x80,
            big,
        ));
        r.extend(mpr(3, big));
        r.extend(ftr(big));
        r.extend(rec(50, 30, &cn("hello wafer"), big));
        let mut generic = u16b(1, big).to_vec();
        generic.extend([1, 7]);
        r.extend(rec(50, 10, &generic, big));
        r.extend(rec(20, 20, &[], big));
        let mut first_prr = prr(1, 2, 0, big);
        first_prr[15..17].copy_from_slice(&u16b(4, big));
        r.extend(first_prr);
        r.extend(pir(1, 2, big));
        r.extend(ptr(7, 1.25_f32.to_bits(), &[], 0, big));
        let mut second_prr = prr(1, 2, 1, big);
        second_prr[15..17].copy_from_slice(&u16b(4, big));
        r.extend(second_prr);
        let mut t = vec![1, 2, b'P'];
        for n in [7_u32, 4, 1, 0] {
            t.extend(u32b(n, big));
        }
        t.extend(cn("CURRENT"));
        r.extend(rec(10, 30, &t, big));
        let mut w = vec![1, 1];
        for n in [200_u32, 2, 1, 0, 1, 1] {
            w.extend(u32b(n, big));
        }
        w.extend(cn("WAFER_A"));
        r.extend(rec(2, 20, &w, big));
        r.extend(finish(big));
        let name = if big {
            "golden-big.stdf"
        } else {
            "golden-little.stdf"
        };
        std::fs::write(std::path::Path::new(&dir).join(name), &r).unwrap();
        // Constants below derive from construction, not the decoder under test.
        let expected = json!({"file":name,"bytes":r.len(),"records":31,"observations":8,"tests":3,"devices":2,
            "pinStates":6,"ptrExecutions":4,"mprExecutions":1,"ftrExecutions":1,"waferSeq":14,
            "deviceIds":[16,26],"prrSeqs":[25,28],"observationSeqs":[17,18,19,20,20,20,21,27],
            "testFamilies":[10,15,20],"testNumbers":[7,8,9],"testNames":["CURRENT","MULTI","SCAN"],
            "returnedPins":[20,21,22],"mprRawBits":[0x7fc01234_u32,0x3f800000_u32,0x40000000_u32],
            "coordinates":[[12,4],[12,4]],"orientation":{"posX":"R","posY":"U","flat":"D","dieAspectRatio":1}});
        std::fs::write(
            std::path::Path::new(&dir).join(name.replace(".stdf", ".expected.json")),
            serde_json::to_string_pretty(&expected).unwrap(),
        )
        .unwrap();
        let (a, s) = parse(&r, 17);
        assert_eq!(s["records"], expected["records"]);
        assert_eq!(s["observations"], expected["observations"]);
        assert_eq!(a["pinStates"].as_array().unwrap().len(), 6);
    }
}
