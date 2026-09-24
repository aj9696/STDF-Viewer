//! Validate present fields before upstream's omitted-field defaults are applied.
use crate::hashing::hex_bytes;
use rust_stdf::{ByteOrder, StdfRecord};
use serde_json::Value;

pub(crate) fn validate_tail(
    body: &[u8],
    fixed: usize,
    widths: &[usize],
    kind: &str,
) -> Result<(), String> {
    if body.len() < fixed {
        return Err(format!("{kind} has incomplete mandatory fixed fields."));
    }
    let mut pos = fixed;
    for &width in widths {
        if pos == body.len() {
            return Ok(());
        }
        let size = if width == 0 {
            1 + usize::from(body[pos])
        } else {
            width
        };
        if body.len() - pos < size {
            return Err(format!("{kind} ends inside a declared field."));
        }
        pos += size;
    }
    if pos != body.len() {
        return Err(format!("{kind} has trailing bytes outside its v4 fields."));
    }
    Ok(())
}

pub(crate) fn uint16(bytes: &[u8], order: ByteOrder) -> u16 {
    let raw = [bytes[0], bytes[1]];
    match order {
        ByteOrder::LittleEndian => u16::from_le_bytes(raw),
        ByteOrder::BigEndian => u16::from_be_bytes(raw),
    }
}

pub(crate) fn uint32(bytes: &[u8], order: ByteOrder) -> u32 {
    let raw = [bytes[0], bytes[1], bytes[2], bytes[3]];
    match order {
        ByteOrder::LittleEndian => u32::from_le_bytes(raw),
        ByteOrder::BigEndian => u32::from_be_bytes(raw),
    }
}

/// Fixed measurement fields never form part of a PTR declaration's identity.
pub(crate) fn ptr_metadata(
    record: &[u8],
    order: ByteOrder,
) -> Result<(Option<String>, String), String> {
    const FIELDS: [(&str, usize); 14] = [
        ("TEST_TXT", 0),
        ("ALARM_ID", 0),
        ("OPT_FLAG", 1),
        ("RES_SCAL", 1),
        ("LLM_SCAL", 1),
        ("HLM_SCAL", 1),
        ("LO_LIMIT", 4),
        ("HI_LIMIT", 4),
        ("UNITS", 0),
        ("C_RESFMT", 0),
        ("C_LLMFMT", 0),
        ("C_HLMFMT", 0),
        ("LO_SPEC", 4),
        ("HI_SPEC", 4),
    ];
    let StdfRecord::PTR(ptr) =
        StdfRecord::read_from_bytes_with_header(record, &order).map_err(|e| e.to_string())?
    else {
        unreachable!()
    };
    let body = &record[4..];
    let name = (body.len() > 12).then(|| ptr.test_txt.clone());
    let mut metadata = serde_json::to_value(ptr).map_err(|e| e.to_string())?;
    let object = metadata.as_object_mut().unwrap();
    for field in [
        "TEST_NUM", "HEAD_NUM", "SITE_NUM", "TEST_FLG", "PARM_FLG", "RESULT",
    ] {
        object.remove(field);
    }
    let mut pos = 12;
    let mut present = Vec::new();
    for (field, width) in FIELDS {
        if pos == body.len() {
            object.insert(field.into(), Value::Null);
            continue;
        }
        present.push(field);
        if width == 4 {
            object.insert(format!("{field}_BITS"), uint32(&body[pos..], order).into());
        }
        pos += if width == 0 {
            1 + usize::from(body[pos])
        } else {
            width
        };
    }
    object.insert(
        "PRESENT_FIELDS".into(),
        serde_json::to_value(present).unwrap(),
    );
    object.insert("RAW_TAIL_HEX".into(), hex_bytes(&body[12..]).into());
    Ok((
        name,
        serde_json::to_string(&metadata).map_err(|e| e.to_string())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn present_variable_and_fixed_fields_must_be_complete() {
        assert!(validate_tail(&[0; 6], 7, &[], "PRR").is_err());
        assert!(validate_tail(&[0; 7], 7, &[2, 0], "PRR").is_ok());
        assert!(validate_tail(&[0; 8], 7, &[2, 0], "PRR").is_err());
        assert!(validate_tail(&[0, 0, 3, b'a'], 2, &[0], "TEST").is_err());
        assert!(validate_tail(&[0; 4], 2, &[0], "TEST").is_err());
    }
}
