//! Versioned, bounded batches for lossless source indexing and retained PTR rows.
use crate::retained_fields::{ptr_metadata, uint16, uint32, validate_tail};
use crate::{validate_ptr, MAX_RECORD_BYTES};
use rust_stdf::{ByteOrder, StdfRecord};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

pub const RETAINED_CHUNK_BYTES: usize = 64 * 1024;
pub const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_DEFINITIONS: usize = 20_000;
pub const MAX_DEFINITION_BYTES: usize = 16 * 1024 * 1024;

pub type RecordRow = (u64, u64, usize, u8, u8, Option<u64>, Option<String>);
pub type DefinitionRow = (u32, u32, Option<String>, String);
pub type MeasurementRow = (u64, u64, u32, u32, u8, u8, u8, u8, u32, Option<f64>);
pub type DeviceRow = (
    u64,
    u8,
    u8,
    u64,
    u8,
    u16,
    u16,
    u16,
    i16,
    i16,
    u32,
    String,
    String,
);

#[derive(Serialize)]
pub struct Batch {
    pub version: u8,
    pub records: Vec<RecordRow>,
    pub definitions: Vec<DefinitionRow>,
    pub measurements: Vec<MeasurementRow>,
    pub devices: Vec<DeviceRow>,
}

impl Default for Batch {
    fn default() -> Self {
        Self {
            version: 1,
            records: vec![],
            definitions: vec![],
            measurements: vec![],
            devices: vec![],
        }
    }
}

#[derive(Debug, Serialize)]
pub struct RetainedSummary {
    pub version: u8,
    pub bytes: u64,
    pub records: u64,
    pub measurements: u64,
    pub devices: u64,
    pub definitions: usize,
    pub byte_order: &'static str,
    pub record_counts: BTreeMap<String, u64>,
    pub coverage: Value,
}

pub struct RetainedEngine {
    carry: Vec<u8>,
    order: Option<ByteOrder>,
    received: u64,
    processed: u64,
    records: u64,
    measurements: u64,
    devices: u64,
    counts: BTreeMap<(u8, u8), u64>,
    definitions: HashMap<u32, HashMap<Vec<u8>, u32>>,
    definition_count: usize,
    definition_bytes: usize,
    open_devices: HashMap<(u8, u8), u64>,
    has_mir: bool,
    has_mrr: bool,
    closed: bool,
}

impl Default for RetainedEngine {
    fn default() -> Self {
        Self {
            carry: Vec::with_capacity(MAX_RECORD_BYTES),
            order: None,
            received: 0,
            processed: 0,
            records: 0,
            measurements: 0,
            devices: 0,
            counts: BTreeMap::new(),
            definitions: HashMap::new(),
            definition_count: 0,
            definition_bytes: 0,
            open_devices: HashMap::new(),
            has_mir: false,
            has_mrr: false,
            closed: false,
        }
    }
}

impl RetainedEngine {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Batch, String> {
        if self.closed {
            return Err("Parser is closed; create a new parser.".into());
        }
        if bytes.len() > RETAINED_CHUNK_BYTES
            || self.received + bytes.len() as u64 > MAX_SOURCE_BYTES
        {
            self.closed = true;
            return Err("Retained input exceeds the 64 KiB chunk or 2 GiB source limit.".into());
        }
        self.received += bytes.len() as u64;
        let mut batch = Batch::default();
        if let Err(error) = self.push_inner(bytes, &mut batch) {
            self.closed = true;
            return Err(format!("{error} (record offset {})", self.processed));
        }
        Ok(batch)
    }

    fn record_size(&self, header: &[u8]) -> Result<usize, String> {
        let order = match self.order {
            Some(order) => order,
            None => {
                if header[2..4] != [0, 10] {
                    return Err(
                        "Expected initial raw STDF FAR; compressed input is unsupported.".into(),
                    );
                }
                match header[0..2] {
                    [2, 0] => ByteOrder::LittleEndian,
                    [0, 2] => ByteOrder::BigEndian,
                    _ => return Err("FAR must declare a two-byte body.".into()),
                }
            }
        };
        Ok(4 + usize::from(uint16(header, order)))
    }

    fn push_inner(&mut self, mut bytes: &[u8], batch: &mut Batch) -> Result<(), String> {
        while !bytes.is_empty() {
            if self.has_mrr {
                return Err("Unexpected bytes after final MRR.".into());
            }
            if !self.carry.is_empty() {
                if self.carry.len() < 4 {
                    let take = (4 - self.carry.len()).min(bytes.len());
                    self.carry.extend_from_slice(&bytes[..take]);
                    bytes = &bytes[take..];
                }
                if self.carry.len() < 4 {
                    break;
                }
                let length = self.record_size(&self.carry[..4])?;
                let take = (length - self.carry.len()).min(bytes.len());
                self.carry.extend_from_slice(&bytes[..take]);
                bytes = &bytes[take..];
                if self.carry.len() < length {
                    break;
                }
                let mut record = std::mem::take(&mut self.carry);
                let result = self.consume(&record, batch);
                record.clear();
                self.carry = record;
                result?;
            } else if bytes.len() < 4 {
                self.carry.extend_from_slice(bytes);
                break;
            } else {
                let length = self.record_size(&bytes[..4])?;
                if bytes.len() < length {
                    self.carry.extend_from_slice(bytes);
                    break;
                }
                self.consume(&bytes[..length], batch)?;
                bytes = &bytes[length..];
            }
        }
        Ok(())
    }

    fn consume(&mut self, record: &[u8], batch: &mut Batch) -> Result<(), String> {
        let kind = (record[2], record[3]);
        let body = &record[4..];
        let seq = self.records + 1;
        if self.order.is_none() {
            let order = if record[0] == 2 {
                ByteOrder::LittleEndian
            } else {
                ByteOrder::BigEndian
            };
            if body[1] != 4
                || !matches!(
                    (body[0], order),
                    (2, ByteOrder::LittleEndian) | (1, ByteOrder::BigEndian)
                )
            {
                return Err("Requires STDF v4 with IEEE FAR CPU type 1 (BE) or 2 (LE).".into());
            }
            self.order = Some(order);
        }
        let order = self.order.unwrap();
        let mut device = None;
        let mut decoded = None;
        match kind {
            (0, 10) => {
                if seq != 1 {
                    return Err("FAR may only occur once, at the start.".into());
                }
                decoded = Some(decode_metadata(record, order)?);
            }
            (1, 10) => {
                if self.has_mir {
                    return Err("Multiple MIR records are unsupported.".into());
                }
                validate_tail(body, 15, &[0; 30], "MIR")?;
                self.has_mir = true;
                decoded = Some(decode_metadata(record, order)?);
            }
            (1, 20) => {
                self.require_mir()?;
                validate_tail(body, 4, &[1, 0, 0], "MRR")?;
                if !self.open_devices.is_empty() {
                    return Err("MRR encountered with open devices.".into());
                }
                self.has_mrr = true;
                decoded = Some(decode_metadata(record, order)?);
            }
            (5, 10) => {
                self.require_mir()?;
                validate_tail(body, 2, &[], "PIR")?;
                if self.open_devices.insert((body[0], body[1]), seq).is_some() {
                    return Err("PIR overlaps an open device on the same head/site.".into());
                }
                device = Some(seq);
                decoded = Some(decode_metadata(record, order)?);
            }
            (5, 20) => {
                self.require_mir()?;
                validate_tail(body, 7, &[2, 2, 2, 4, 0, 0, 0], "PRR")?;
                let id = self
                    .open_devices
                    .remove(&(body[0], body[1]))
                    .ok_or("PRR has no matching PIR on its head/site.")?;
                let StdfRecord::PRR(prr) = StdfRecord::read_from_bytes_with_header(record, &order)
                    .map_err(|e| e.to_string())?
                else {
                    unreachable!()
                };
                decoded = Some(serde_json::to_string(&prr).map_err(|e| e.to_string())?);
                batch.devices.push((
                    id,
                    prr.head_num,
                    prr.site_num,
                    seq,
                    prr.part_flg[0],
                    prr.num_test,
                    prr.hard_bin,
                    prr.soft_bin,
                    prr.x_coord,
                    prr.y_coord,
                    prr.test_t,
                    prr.part_id,
                    prr.part_txt,
                ));
                self.devices += 1;
                device = Some(id);
            }
            (15, 10) => {
                validate_ptr(body)?;
                let id = self.device_for(body[4], body[5])?;
                let number = uint32(body, order);
                let definition = match self
                    .definitions
                    .get(&number)
                    .and_then(|tails| tails.get(&body[12..]))
                {
                    Some(&id) => id,
                    None => {
                        if self.definition_count >= MAX_DEFINITIONS
                            || self.definition_bytes + body.len() - 12 > MAX_DEFINITION_BYTES
                        {
                            return Err("METADATA_LIMIT: exceeded 20,000 PTR declarations or 16 MiB of exact declaration tails.".into());
                        }
                        let id = self.definition_count as u32 + 1;
                        let (name, metadata) = ptr_metadata(record, order)?;
                        self.definitions
                            .entry(number)
                            .or_default()
                            .insert(body[12..].to_vec(), id);
                        self.definition_count += 1;
                        self.definition_bytes += body.len() - 12;
                        batch.definitions.push((id, number, name, metadata));
                        id
                    }
                };
                let bits = uint32(&body[8..], order);
                let result = f32::from_bits(bits);
                batch.measurements.push((
                    seq,
                    id,
                    definition,
                    number,
                    body[4],
                    body[5],
                    body[6],
                    body[7],
                    bits,
                    result.is_finite().then_some(f64::from(result)),
                ));
                self.measurements += 1;
                device = Some(id);
            }
            (15, 15) => {
                // MPR arrays are indexed rather than normalized; verify mandatory payload bounds.
                if body.len() < 12 {
                    return Err("MPR has incomplete mandatory fixed fields.".into());
                }
                let pins = usize::from(uint16(&body[8..], order));
                let results = usize::from(uint16(&body[10..], order));
                let mandatory = 12 + pins.div_ceil(2) + results * 4;
                if body.len() < mandatory {
                    return Err("MPR has incomplete mandatory arrays.".into());
                }
                device = Some(self.device_for(body[4], body[5])?);
            }
            (15, 20) => {
                if body.len() < 7 {
                    return Err("FTR has incomplete mandatory fixed fields.".into());
                }
                device = Some(self.device_for(body[4], body[5])?);
            }
            _ => {}
        }
        batch.records.push((
            seq,
            self.processed,
            record.len(),
            kind.0,
            kind.1,
            device,
            decoded,
        ));
        *self.counts.entry(kind).or_default() += 1;
        self.records += 1;
        self.processed += record.len() as u64;
        Ok(())
    }

    fn require_mir(&self) -> Result<(), String> {
        if !self.has_mir {
            return Err("MIR must precede devices and results.".into());
        }
        Ok(())
    }

    fn device_for(&self, head: u8, site: u8) -> Result<u64, String> {
        self.require_mir()?;
        self.open_devices
            .get(&(head, site))
            .copied()
            .ok_or_else(|| format!("Result has no open PIR for head {head}, site {site}."))
    }

    pub fn finish(&mut self) -> Result<RetainedSummary, String> {
        if self.closed {
            return Err("Parser is closed; create a new parser.".into());
        }
        self.closed = true;
        if self.order.is_none() || !self.carry.is_empty() {
            return Err(format!(
                "Truncated STDF at byte {}; {} pending bytes.",
                self.processed,
                self.carry.len()
            ));
        }
        if !self.has_mir || !self.has_mrr || !self.open_devices.is_empty() {
            return Err("Incomplete STDF: require MIR, matched PIR/PRR and final MRR.".into());
        }
        let indexed_only: BTreeMap<String, u64> = self
            .counts
            .iter()
            .filter(|(kind, _)| {
                !matches!(
                    kind,
                    (0, 10) | (1, 10) | (1, 20) | (5, 10) | (5, 20) | (15, 10)
                )
            })
            .map(|(&(typ, sub), &count)| (format!("{typ}/{sub}"), count))
            .collect();
        Ok(RetainedSummary {
            version: 1,
            bytes: self.received,
            records: self.records,
            measurements: self.measurements,
            devices: self.devices,
            definitions: self.definition_count,
            byte_order: if self.order == Some(ByteOrder::LittleEndian) {
                "little"
            } else {
                "big"
            },
            record_counts: self
                .counts
                .iter()
                .map(|(&(typ, sub), &count)| (format!("{typ}/{sub}"), count))
                .collect(),
            coverage: json!({
                "decoded_metadata": ["FAR", "MIR", "MRR", "PIR", "PRR"],
                "measurement_families": ["PTR"], "indexed_only": indexed_only,
                "original_source_retained_by_importer": true,
                "limitations": ["MPR/FTR retain device context and raw indexes, not normalized measurements.",
                    "Indexed-only record families are framed but their complete field semantics are not validated.",
                    "PTR declarations preserve omissions; defaults and analytical populations are unresolved."]
            }),
        })
    }
}

fn decode_metadata(record: &[u8], order: ByteOrder) -> Result<String, String> {
    let decoded =
        StdfRecord::read_from_bytes_with_header(record, &order).map_err(|e| e.to_string())?;
    match decoded {
        StdfRecord::FAR(value) => serde_json::to_string(&value),
        StdfRecord::MIR(value) => serde_json::to_string(&value),
        StdfRecord::MRR(value) => serde_json::to_string(&value),
        StdfRecord::PIR(value) => serde_json::to_string(&value),
        _ => unreachable!(),
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_limit_fails_before_accepting_more_input() {
        let mut engine = RetainedEngine::default();
        engine.received = MAX_SOURCE_BYTES;
        assert!(engine.push(&[0]).is_err());
        assert!(engine.push(&[]).is_err());
    }
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::RetainedEngine;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct RetainedParser(RetainedEngine);

    #[wasm_bindgen]
    impl RetainedParser {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self(RetainedEngine::default())
        }
        pub fn push(&mut self, bytes: &[u8]) -> Result<String, JsValue> {
            self.0
                .push(bytes)
                .and_then(|batch| serde_json::to_string(&batch).map_err(|e| e.to_string()))
                .map_err(|e| JsValue::from_str(&e))
        }
        pub fn finish(&mut self) -> Result<String, JsValue> {
            self.0
                .finish()
                .and_then(|summary| serde_json::to_string(&summary).map_err(|e| e.to_string()))
                .map_err(|e| JsValue::from_str(&e))
        }
        pub fn memory_bytes(&self) -> usize {
            core::arch::wasm32::memory_size(0) * 65536
        }
    }
}
