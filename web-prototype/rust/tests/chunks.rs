use semidata_web_parser::{Engine, MAX_CHUNK_BYTES, MAX_RECORD_BYTES};

fn record(kind: u8, subtype: u8, body: &[u8], big: bool) -> Vec<u8> {
    let length = body.len() as u16;
    let mut bytes = if big {
        length.to_be_bytes()
    } else {
        length.to_le_bytes()
    }
    .to_vec();
    bytes.extend([kind, subtype]);
    bytes.extend(body);
    bytes
}

fn fixture(big: bool) -> Vec<u8> {
    let mut bytes = record(0, 10, &[if big { 1 } else { 2 }, 4], big);
    for (value, test_flag, parm_flag) in
        [(0.125_f32, 0, 0), (0.25, 128, 0), (0.5, 2, 0), (1.0, 0, 1)]
    {
        let mut ptr = if big {
            77_u32.to_be_bytes()
        } else {
            77_u32.to_le_bytes()
        }
        .to_vec();
        ptr.extend([1, 2, test_flag, parm_flag]);
        ptr.extend(if big {
            value.to_be_bytes()
        } else {
            value.to_le_bytes()
        });
        ptr.extend([3, b'V', b'D', b'D', 0, 2, 3, 0, 0]);
        ptr.extend([0; 8]);
        ptr.extend([1, b'V']);
        bytes.extend(record(15, 10, &ptr, big));
    }
    bytes.extend(record(1, 20, &[0; 7], big));
    bytes
}

#[test]
fn all_chunk_boundaries_preserve_results() {
    for big in [false, true] {
        let bytes = fixture(big);
        let mut baseline = Engine::default();
        baseline.push(&bytes).unwrap();
        let expected = baseline.finish().unwrap();
        assert_eq!(expected.ptr_count, 4);
        assert_eq!(expected.groups[0].valid, 2);
        assert_eq!(expected.groups[0].excluded, 2);
        assert_eq!(expected.groups[0].mean_raw, Some(0.1875));
        assert_eq!(expected.groups[0].mean_scaled, Some(187.5));
        for chunk in 1..bytes.len() {
            let mut parser = Engine::default();
            for part in bytes.chunks(chunk) {
                parser.push(part).unwrap();
            }
            let actual = parser.finish().unwrap();
            assert_eq!(actual.ptr_digest, expected.ptr_digest);
            assert_eq!(actual.records, expected.records);
            assert_eq!(actual.groups[0].mean_raw, expected.groups[0].mean_raw);
            assert!(actual.max_pending_bytes <= MAX_RECORD_BYTES);
        }
    }
}

#[test]
fn truncation_and_malformed_fields_fail_closed() {
    let bytes = fixture(false);
    let mut parser = Engine::default();
    parser.push(&bytes[..bytes.len() - 1]).unwrap();
    assert!(parser.finish().unwrap_err().contains("Truncated"));
    let mut parser = Engine::default();
    parser.push(&bytes[..6]).unwrap();
    let broken = record(15, 10, &[0; 11], false);
    assert!(parser.push(&broken).unwrap_err().contains("fixed fields"));
    assert!(parser.push(&[]).is_err());
    let mut parser = Engine::default();
    assert!(parser.push(&vec![0; MAX_CHUNK_BYTES + 1]).is_err());
}

#[test]
fn largest_record_has_bounded_carry() {
    let mut parser = Engine::default();
    parser.push(&record(0, 10, &[2, 4], false)).unwrap();
    let unknown = record(200, 200, &vec![0; u16::MAX as usize], false);
    for chunk in unknown.chunks(4096) {
        parser.push(chunk).unwrap();
    }
    let result = parser.finish().unwrap();
    assert_eq!(result.records, 2);
    assert_eq!(result.max_pending_bytes, MAX_RECORD_BYTES);
    assert_eq!(result.carry_capacity, MAX_RECORD_BYTES);
    assert!(!result.has_mrr);
}

#[test]
fn omitted_names_use_unambiguous_preceding_identity_only() {
    let bytes = fixture(false);
    let mut parser = Engine::default();
    parser.push(&bytes).unwrap();
    let mut compact = 77_u32.to_le_bytes().to_vec();
    compact.extend([1, 2, 0, 0]);
    compact.extend(0.375_f32.to_le_bytes());
    parser.push(&record(15, 10, &compact, false)).unwrap();
    let result = parser.finish().unwrap();
    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].name, "VDD");
    assert_eq!(result.groups[0].unit, "V");
    assert_eq!(result.groups[0].result_scale, 3);
    assert_eq!(result.groups[0].valid, 3);

    let mut parser = Engine::default();
    parser.push(&bytes).unwrap();
    let mut changed = compact.clone();
    changed.extend([3, b'I', b'D', b'D']);
    parser.push(&record(15, 10, &changed, false)).unwrap();
    assert!(parser
        .push(&record(15, 10, &compact, false))
        .unwrap_err()
        .contains("ambiguous"));

    let mut parser = Engine::default();
    parser.push(&bytes).unwrap();
    compact.push(0); // Explicitly present empty TEST_TXT is a separate identity.
    parser.push(&record(15, 10, &compact, false)).unwrap();
    assert_eq!(parser.finish().unwrap().groups.len(), 2);
}

#[test]
fn flagged_scale_reuses_default_and_changed_valid_scale_stays_separate() {
    let bytes = fixture(false);
    let mut parser = Engine::default();
    parser.push(&bytes).unwrap();
    let mut fields = 77_u32.to_le_bytes().to_vec();
    fields.extend([1, 2, 0, 0]);
    fields.extend(0.375_f32.to_le_bytes());
    fields.extend([3, b'V', b'D', b'D', 0, 3, 6]); // OPT bit 0 invalidates scale 6.
    parser.push(&record(15, 10, &fields, false)).unwrap();
    fields[17] = 2; // Same explicit scale becomes valid.
    parser.push(&record(15, 10, &fields, false)).unwrap();
    let result = parser.finish().unwrap();
    assert_eq!(result.groups.len(), 2);
    assert_eq!(result.groups[0].result_scale, 3);
    assert_eq!(result.groups[0].count, 5);
    assert_eq!(result.groups[1].result_scale, 6);
    assert_eq!(result.groups[1].count, 1);
}

#[test]
fn empty_and_named_identities_make_later_omission_ambiguous() {
    let mut fixed = 77_u32.to_le_bytes().to_vec();
    fixed.extend([1, 2, 0, 0]);
    fixed.extend(0.125_f32.to_le_bytes());
    let mut empty = fixed.clone();
    empty.push(0);
    let mut named = fixed.clone();
    named.extend([1, b'A']);
    for sequence in [[&empty, &named], [&named, &empty], [&fixed, &named]] {
        let mut parser = Engine::default();
        parser.push(&record(0, 10, &[2, 4], false)).unwrap();
        for body in sequence {
            parser.push(&record(15, 10, body, false)).unwrap();
        }
        assert!(parser
            .push(&record(15, 10, &fixed, false))
            .unwrap_err()
            .contains("ambiguous"));
    }
}
