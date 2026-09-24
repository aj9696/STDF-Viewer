//! Bounded STDF framing with actual upstream borrowed record views.
use rust_stdf::{ByteOrder, RecordHeader, StdfRecordView};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

pub const MAX_CHUNK_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_RECORD_BYTES: usize = u16::MAX as usize + 4;
pub const MAX_GROUPS: usize = 20_000;
const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn hash_bytes(hash: &mut u64, bytes: &[u8]) {
    for &byte in bytes {
        *hash = (*hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME);
    }
}

fn hash_text(hash: &mut u64, text: &str) {
    hash_bytes(hash, &(text.len() as u32).to_le_bytes());
    hash_bytes(hash, text.as_bytes());
}

#[derive(Default)]
struct Moments {
    count: u64,
    valid: u64,
    failed_flag: u64,
    unknown_pass_fail: u64,
    mean: f64,
    m2: f64,
    min: f64,
    max: f64,
}

impl Moments {
    fn add(&mut self, value: f64, test_flag: u8, parm_flag: u8) {
        self.count += 1;
        self.failed_flag += u64::from(test_flag & 0x80 != 0);
        self.unknown_pass_fail += u64::from(test_flag & 0x40 != 0);
        if !value.is_finite() || test_flag & 0x3f != 0 || parm_flag & 0x07 != 0 {
            return;
        }
        self.valid += 1;
        if self.valid == 1 {
            self.min = value;
            self.max = value;
        } else {
            self.min = self.min.min(value);
            self.max = self.max.max(value);
        }
        let delta = value - self.mean;
        self.mean += delta / self.valid as f64;
        self.m2 += delta * (value - self.mean);
    }
}

#[derive(Default)]
struct TestState {
    default_scale: i8,
    default_unit: String,
    // Immutable first identity; map cardinality detects ambiguity, including empty names.
    default_name: String,
    // Borrowed lookup avoids allocating names or units on every PTR.
    names: HashMap<String, HashMap<String, BTreeMap<i8, Moments>>>,
}

#[derive(Debug, Serialize)]
pub struct Group {
    pub number: u32,
    pub name: String,
    pub unit: String,
    pub result_scale: i8,
    pub count: u64,
    pub valid: u64,
    pub excluded: u64,
    pub failed_flag: u64,
    pub unknown_pass_fail: u64,
    pub mean_raw: Option<f64>,
    pub stdev_raw: Option<f64>,
    pub min_raw: Option<f64>,
    pub max_raw: Option<f64>,
    pub mean_scaled: Option<f64>,
    pub scaled_unit: String,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub schema_version: u8,
    pub engine: &'static str,
    pub byte_order: &'static str,
    pub bytes: u64,
    pub records: u64,
    pub ptr_count: u64,
    pub record_counts: BTreeMap<String, u64>,
    pub flag_counts: BTreeMap<String, u64>,
    pub ptr_digest: String,
    pub groups: Vec<Group>,
    pub max_pending_bytes: usize,
    pub max_input_bytes: usize,
    pub carry_capacity: usize,
    pub has_mrr: bool,
}

#[derive(Serialize)]
pub struct Progress {
    pub bytes: u64,
    pub records: u64,
    pub ptr_count: u64,
    pub group_count: usize,
    pub pending_bytes: usize,
    pub max_pending_bytes: usize,
    pub max_input_bytes: usize,
}

pub struct Engine {
    carry: Vec<u8>,
    order: Option<ByteOrder>,
    received: u64,
    processed: u64,
    records: u64,
    ptr_count: u64,
    counts: BTreeMap<(u8, u8), u64>,
    flags: Vec<u64>,
    tests: HashMap<u32, TestState>,
    group_count: usize,
    digest: u64,
    max_pending: usize,
    max_input: usize,
    failed: bool,
    finished: bool,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            carry: Vec::with_capacity(MAX_RECORD_BYTES),
            order: None,
            received: 0,
            processed: 0,
            records: 0,
            ptr_count: 0,
            counts: BTreeMap::new(),
            flags: vec![0; 65536],
            tests: HashMap::new(),
            group_count: 0,
            digest: FNV_OFFSET,
            max_pending: 0,
            max_input: 0,
            failed: false,
            finished: false,
        }
    }
}

impl Engine {
    pub fn push(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.failed || self.finished {
            return Err("Parser is closed; create a new parser for another file.".into());
        }
        if bytes.len() > MAX_CHUNK_BYTES {
            self.failed = true;
            return Err("Input chunk exceeds the 4 MiB boundary.".into());
        }
        self.max_input = self.max_input.max(bytes.len());
        self.received += bytes.len() as u64;
        if let Err(message) = self.push_inner(bytes) {
            self.failed = true;
            return Err(format!("{message} (record offset {})", self.processed));
        }
        Ok(())
    }

    fn record_size(&self, header: &[u8]) -> Result<usize, String> {
        let order = match self.order {
            Some(order) => order,
            None => {
                if header[2..4] != [0, 10] {
                    return Err("Expected raw STDF FAR; compressed input is unsupported.".into());
                }
                match header[0..2] {
                    [2, 0] => ByteOrder::LittleEndian,
                    [0, 2] => ByteOrder::BigEndian,
                    _ => return Err("FAR must declare a two-byte body.".into()),
                }
            }
        };
        let length = match order {
            ByteOrder::LittleEndian => u16::from_le_bytes([header[0], header[1]]),
            ByteOrder::BigEndian => u16::from_be_bytes([header[0], header[1]]),
        };
        Ok(4 + usize::from(length))
    }

    fn push_inner(&mut self, mut bytes: &[u8]) -> Result<(), String> {
        while !bytes.is_empty() {
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
                self.max_pending = self.max_pending.max(self.carry.len());
                if self.carry.len() < length {
                    break;
                }
                let mut record = std::mem::take(&mut self.carry);
                let outcome = self.consume(&record);
                record.clear();
                self.carry = record;
                outcome?;
            } else if bytes.len() < 4 {
                self.carry.extend_from_slice(bytes);
                break;
            } else {
                let length = self.record_size(&bytes[..4])?;
                if bytes.len() < length {
                    self.carry.extend_from_slice(bytes);
                    break;
                }
                self.consume(&bytes[..length])?;
                bytes = &bytes[length..];
            }
        }
        self.max_pending = self.max_pending.max(self.carry.len());
        Ok(())
    }

    fn consume(&mut self, record: &[u8]) -> Result<(), String> {
        if self.order.is_none() {
            let order = if record[0] == 2 {
                ByteOrder::LittleEndian
            } else {
                ByteOrder::BigEndian
            };
            if record[5] != 4
                || !matches!(
                    (record[4], order),
                    (2, ByteOrder::LittleEndian) | (1, ByteOrder::BigEndian)
                )
            {
                return Err(
                    "This prototype requires STDF v4 with IEEE FAR CPU type 1 (BE) or 2 (LE)."
                        .into(),
                );
            }
            self.order = Some(order);
        }
        let order = self.order.unwrap();
        let header = RecordHeader::new()
            .read_from_bytes(&record[..4], &order)
            .map_err(|e| e.to_string())?;
        let body = &record[4..];
        if (header.typ, header.sub) == (15, 10) {
            validate_ptr(body)?;
            if let StdfRecordView::PTR(ptr) = StdfRecordView::read_from_bytes(header, body, &order)
            {
                let number = ptr.test_num();
                let name = ptr.test_txt().as_str();
                let unit_value = ptr.units().map(|unit| unit.as_str());
                let explicit_unit = unit_value.as_deref().filter(|unit| !unit.is_empty());
                let explicit_scale = ptr
                    .res_scal()
                    .filter(|_| ptr.opt_flag().is_some_and(|flag| flag[0] & 1 == 0));
                let state = self.tests.entry(number).or_insert_with(|| TestState {
                    default_scale: explicit_scale.unwrap_or(0),
                    default_unit: explicit_unit.unwrap_or("").to_owned(),
                    default_name: name.to_string(),
                    ..TestState::default()
                });
                if body.len() == 12 && state.names.len() > 1 {
                    return Err(format!("PTR {number} omits its name after multiple distinct names; identity is ambiguous."));
                }
                let name = if body.len() == 12 {
                    state.default_name.as_str()
                } else {
                    name.as_ref()
                };
                let scale = explicit_scale.unwrap_or(state.default_scale);
                let unit = explicit_unit.unwrap_or(&state.default_unit);
                let test_flag = ptr.test_flg()[0];
                let parm_flag = ptr.parm_flg()[0];
                let value = ptr.result();
                // Canonical little-endian fixed fields + length-prefixed decoded metadata.
                hash_bytes(&mut self.digest, &number.to_le_bytes());
                hash_bytes(
                    &mut self.digest,
                    &[ptr.head_num(), ptr.site_num(), test_flag, parm_flag],
                );
                hash_bytes(&mut self.digest, &value.to_bits().to_le_bytes());
                hash_text(&mut self.digest, &name);
                hash_text(&mut self.digest, unit);
                hash_bytes(&mut self.digest, &[scale as u8]);
                self.flags[(usize::from(test_flag) << 8) | usize::from(parm_flag)] += 1;
                let names = &mut state.names;
                if !names.contains_key(name) {
                    names.insert(name.to_string(), HashMap::new());
                }
                let units = names.get_mut(name).unwrap();
                if !units.contains_key(unit) {
                    units.insert(unit.to_owned(), BTreeMap::new());
                }
                let scales = units.get_mut(unit).unwrap();
                if !scales.contains_key(&scale) {
                    if self.group_count >= MAX_GROUPS {
                        return Err("Exceeded 20,000 test/metadata summary groups.".into());
                    }
                    scales.insert(scale, Moments::default());
                    self.group_count += 1;
                }
                scales
                    .get_mut(&scale)
                    .unwrap()
                    .add(f64::from(value), test_flag, parm_flag);
                self.ptr_count += 1;
            }
        }
        *self.counts.entry((header.typ, header.sub)).or_default() += 1;
        self.records += 1;
        self.processed += record.len() as u64;
        Ok(())
    }

    pub fn progress(&self) -> Progress {
        Progress {
            bytes: self.processed,
            records: self.records,
            ptr_count: self.ptr_count,
            group_count: self.group_count,
            pending_bytes: self.carry.len(),
            max_pending_bytes: self.max_pending,
            max_input_bytes: self.max_input,
        }
    }

    pub fn finish(&mut self) -> Result<Summary, String> {
        if self.failed || self.finished {
            return Err("Parser is closed; create a new parser.".into());
        }
        self.finished = true;
        if self.order.is_none() || !self.carry.is_empty() {
            return Err(format!(
                "Truncated STDF record at byte {}; {} pending bytes.",
                self.processed,
                self.carry.len()
            ));
        }
        let mut groups = Vec::with_capacity(self.group_count);
        for (&number, test) in &self.tests {
            for (name, units) in &test.names {
                for (unit, scales) in units {
                    for (&scale, m) in scales {
                        let mean = (m.valid > 0).then_some(m.mean);
                        let scaled = mean.map(|v| v * 10_f64.powi(i32::from(scale)));
                        groups.push(Group {
                            number,
                            name: name.clone(),
                            unit: unit.clone(),
                            result_scale: scale,
                            count: m.count,
                            valid: m.valid,
                            excluded: m.count - m.valid,
                            failed_flag: m.failed_flag,
                            unknown_pass_fail: m.unknown_pass_fail,
                            mean_raw: mean,
                            stdev_raw: (m.valid > 1).then(|| (m.m2 / (m.valid - 1) as f64).sqrt()),
                            min_raw: (m.valid > 0).then_some(m.min),
                            max_raw: (m.valid > 0).then_some(m.max),
                            mean_scaled: scaled.filter(|v| v.is_finite()),
                            scaled_unit: if scale == 0 {
                                unit.clone()
                            } else {
                                format!("10^{} {}", -i16::from(scale), unit)
                            },
                        });
                    }
                }
            }
        }
        groups.sort_by(|a, b| {
            (&a.number, &a.name, &a.unit, &a.result_scale).cmp(&(
                &b.number,
                &b.name,
                &b.unit,
                &b.result_scale,
            ))
        });
        Ok(Summary {
            schema_version: 1,
            engine: "rust-stdf 1.1.0 / bounded adapter 0.1.0",
            byte_order: if self.order == Some(ByteOrder::LittleEndian) {
                "little"
            } else {
                "big"
            },
            bytes: self.received,
            records: self.records,
            ptr_count: self.ptr_count,
            record_counts: self
                .counts
                .iter()
                .map(|(&(typ, sub), &count)| (format!("{typ}/{sub}"), count))
                .collect(),
            flag_counts: self
                .flags
                .iter()
                .enumerate()
                .filter(|(_, count)| **count != 0)
                .map(|(key, &count)| (format!("{:02x}/{:02x}", key >> 8, key & 255), count))
                .collect(),
            ptr_digest: format!("{:016x}", self.digest),
            groups,
            max_pending_bytes: self.max_pending,
            max_input_bytes: self.max_input,
            carry_capacity: self.carry.capacity(),
            has_mrr: self.counts.contains_key(&(1, 20)),
        })
    }
}

// Upstream getters default omitted fields. Reject malformed present fields first.
fn validate_ptr(body: &[u8]) -> Result<(), String> {
    if body.len() < 12 {
        return Err("PTR has incomplete mandatory fixed fields.".into());
    }
    let mut pos = 12;
    // TEST_TXT / ALARM_ID, then optional flags/scales/limits/units/formats/specs.
    for width in [0, 0, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0, 4, 4] {
        if pos == body.len() {
            return Ok(());
        }
        let size = if width == 0 {
            1 + usize::from(body[pos])
        } else {
            width
        };
        if body.len() - pos < size {
            return Err("PTR ends inside a declared field.".into());
        }
        pos += size;
    }
    if pos != body.len() {
        return Err("PTR has trailing bytes outside its v4 fields.".into());
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::Engine;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct Parser {
        engine: Engine,
    }

    #[wasm_bindgen]
    impl Parser {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self {
                engine: Engine::default(),
            }
        }
        pub fn push(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
            self.engine
                .push(bytes)
                .map_err(|message| JsValue::from_str(&message))
        }
        pub fn progress(&self) -> String {
            serde_json::to_string(&self.engine.progress()).unwrap()
        }
        pub fn finish(&mut self) -> Result<String, JsValue> {
            self.engine
                .finish()
                .map(|summary| serde_json::to_string(&summary).unwrap())
                .map_err(|message| JsValue::from_str(&message))
        }
        pub fn memory_bytes(&self) -> usize {
            core::arch::wasm32::memory_size(0) * 65536
        }
    }
}
