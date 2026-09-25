//! Disposable, bounded browser viewer projection. Retained-v1 is unchanged.
use crate::retained::{
    MAX_DEFINITIONS, MAX_DEFINITION_BYTES, MAX_SOURCE_BYTES, RETAINED_CHUNK_BYTES,
};
use crate::retained_fields::{uint16, uint32, validate_tail};
use crate::viewer_fields::{self as fields, Effective, Layout};
use rust_stdf::ByteOrder;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;

pub const MAX_BATCH_ROWS: usize = 2048;
pub const MAX_BATCH_BYTES: usize = 2 * 1024 * 1024;
pub type TestRow = (u32, u8, u32, String, u64, String);
pub type ObservationRow = (
    u64,
    u32,
    u64,
    u32,
    u8,
    u8,
    u8,
    Option<u8>,
    Option<u32>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    u64,
    String,
    Option<u16>,
);
pub type PinRow = (u64, &'static str, u32, Option<u16>, Option<u8>);
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
    Option<u64>,
);
pub type MetadataRow = (u64, u64, u8, u8, Option<u64>, String);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerBatch {
    pub version: u8,
    pub pending: bool,
    pub tests: Vec<TestRow>,
    pub observations: Vec<ObservationRow>,
    pub pin_states: Vec<PinRow>,
    pub devices: Vec<DeviceRow>,
    pub metadata: Vec<MetadataRow>,
}
impl Default for ViewerBatch {
    fn default() -> Self {
        Self {
            version: 1,
            pending: false,
            tests: vec![],
            observations: vec![],
            pin_states: vec![],
            devices: vec![],
            metadata: vec![],
        }
    }
}
enum Row {
    Test(TestRow),
    Observation(ObservationRow),
    Pin(PinRow),
    Device(DeviceRow),
    Metadata(MetadataRow),
}
impl Row {
    // Conservative JSON size bounds: strings may escape each byte to six bytes.
    fn size_bound(&self) -> usize {
        match self {
            Self::Test(r) => 256 + r.3.len() * 6 + r.5.len() * 2,
            Self::Observation(r) => 512 + r.14.len() * 6,
            Self::Pin(_) => 128,
            Self::Device(r) => 512 + (r.11.len() + r.12.len()) * 6,
            Self::Metadata(r) => 128 + r.5.len() * 2,
        }
    }
    fn append(self, b: &mut ViewerBatch) {
        match self {
            Self::Test(r) => b.tests.push(r),
            Self::Observation(r) => b.observations.push(r),
            Self::Pin(r) => b.pin_states.push(r),
            Self::Device(r) => b.devices.push(r),
            Self::Metadata(r) => b.metadata.push(r),
        }
    }
}
#[derive(Clone, Hash, PartialEq, Eq)]
enum Name {
    Present(String),
    Omitted,
    Ambiguous,
}
struct Test {
    defaults: Effective,
}
struct Declaration {
    id: u64,
    test_id: u32,
    effective: Effective,
}
struct OpenDevice {
    id: u64,
    wafer: Option<u64>,
}

#[derive(Default)]
pub struct ViewerEngine {
    input: Vec<u8>,
    input_pos: usize,
    output: VecDeque<Row>,
    order: Option<ByteOrder>,
    received: u64,
    processed: u64,
    records: u64,
    observations: u64,
    devices: u64,
    metadata: u64,
    closed: bool,
    has_mir: bool,
    has_mrr: bool,
    open: HashMap<(u8, u8), OpenDevice>,
    wafers: HashMap<u8, u64>,
    sections: Vec<String>,
    identities: HashMap<(u8, u32, Name), u32>,
    names: HashMap<(u8, u32), Vec<u32>>,
    tests: Vec<Test>,
    declarations: HashMap<(u32, String, Vec<u8>), Arc<Declaration>>,
    metadata_bytes: usize,
    counts: BTreeMap<String, u64>,
    warnings: Vec<String>,
}
impl ViewerEngine {
    pub fn push(&mut self, bytes: &[u8]) -> Result<ViewerBatch, String> {
        if self.closed {
            return Err("Viewer parser is closed.".into());
        }
        if self.pending() {
            return Err("Drain pending viewer output before pushing input.".into());
        }
        if bytes.len() > RETAINED_CHUNK_BYTES
            || self.received + bytes.len() as u64 > MAX_SOURCE_BYTES
        {
            self.closed = true;
            return Err("Viewer input exceeds 64 KiB chunk or 2 GiB source limit.".into());
        }
        self.input.drain(..self.input_pos);
        self.input_pos = 0;
        self.input.extend_from_slice(bytes);
        self.received += bytes.len() as u64;
        self.drain()
    }
    fn next_len(&self) -> Option<usize> {
        let b = &self.input[self.input_pos..];
        if b.len() < 4 {
            return None;
        }
        let order = self.order.unwrap_or(if b[0] == 2 {
            ByteOrder::LittleEndian
        } else {
            ByteOrder::BigEndian
        });
        let n = uint16(b, order) as usize + 4;
        (b.len() >= n).then_some(n)
    }
    fn pending(&self) -> bool {
        !self.output.is_empty() || self.next_len().is_some()
    }
    pub fn drain(&mut self) -> Result<ViewerBatch, String> {
        if self.closed {
            return Err("Viewer parser is closed.".into());
        }
        let result = self.drain_inner();
        if result.is_err() {
            self.closed = true;
        }
        result
    }
    fn drain_inner(&mut self) -> Result<ViewerBatch, String> {
        let mut batch = ViewerBatch::default();
        let mut rows = 0;
        let mut bytes = 256;
        loop {
            if let Some(row) = self.output.front() {
                let size = row.size_bound();
                if size + 256 > MAX_BATCH_BYTES {
                    return Err(
                        "METADATA_LIMIT: one decoded row exceeds the 2 MiB batch limit.".into(),
                    );
                }
                if rows == MAX_BATCH_ROWS || bytes + size > MAX_BATCH_BYTES {
                    break;
                }
                self.output.pop_front().unwrap().append(&mut batch);
                rows += 1;
                bytes += size;
                continue;
            }
            if rows == MAX_BATCH_ROWS {
                break;
            }
            let Some(n) = self.next_len() else {
                break;
            };
            let record = self.input[self.input_pos..self.input_pos + n].to_vec();
            self.consume(&record).map_err(|e| {
                format!(
                    "{e} (record {} at offset {})",
                    self.records + 1,
                    self.processed
                )
            })?;
            self.input_pos += n;
            self.processed += n as u64;
            self.records += 1;
        }
        batch.pending = self.pending();
        Ok(batch)
    }
    fn warn(&mut self, message: String) {
        if self.warnings.len() < 100 && !self.warnings.contains(&message) {
            self.warnings.push(message);
        }
    }
    fn cold(&mut self, seq: u64, typ: u8, sub: u8, device: Option<u64>, value: Value) {
        self.output.push_back(Row::Metadata((
            seq,
            seq,
            typ,
            sub,
            device,
            value.to_string(),
        )));
        self.metadata += 1;
    }
    fn consume(&mut self, record: &[u8]) -> Result<(), String> {
        let seq = self.records + 1;
        let typ = record[2];
        let sub = record[3];
        let body = &record[4..];
        if self.has_mrr {
            return Err("Bytes follow final MRR.".into());
        }
        if self.order.is_none() {
            if record.len() != 6 || typ != 0 || sub != 10 || body[1] != 4 {
                return Err("Expected initial STDF v4 FAR.".into());
            }
            self.order = match (record[0], record[1], body[0]) {
                (2, 0, 2) => Some(ByteOrder::LittleEndian),
                (0, 2, 1) => Some(ByteOrder::BigEndian),
                _ => return Err("FAR byte order/CPU mismatch.".into()),
            };
        }
        let order = self.order.unwrap();
        *self.counts.entry(format!("{typ}/{sub}")).or_default() += 1;
        if typ == 15 && matches!(sub, 10 | 15 | 20) {
            return self.test_record(seq, sub, body, order);
        }
        match (typ, sub) {
            (0, 10) if seq != 1 => return Err("FAR may only occur at source start.".into()),
            (1, 10) => {
                if self.has_mir {
                    return Err("Multiple MIR records are unsupported.".into());
                }
                validate_tail(body, 15, &[0; 30], "MIR")?;
                self.has_mir = true;
            }
            (1, 20) => {
                validate_tail(body, 4, &[1, 0, 0], "MRR")?;
                if !self.has_mir || !self.open.is_empty() {
                    return Err("MRR requires MIR and closed devices.".into());
                }
                self.has_mrr = true;
            }
            (5, 10) => {
                validate_tail(body, 2, &[], "PIR")?;
                if !self.has_mir {
                    return Err("PIR precedes MIR.".into());
                }
                let key = (body[0], body[1]);
                if self.open.contains_key(&key) {
                    return Err("Overlapping PIR on head/site.".into());
                }
                self.open.insert(
                    key,
                    OpenDevice {
                        id: seq,
                        wafer: self.wafers.get(&body[0]).copied(),
                    },
                );
                return Ok(());
            }
            (5, 20) => {
                validate_tail(body, 7, &[2, 2, 2, 4, 0, 0, 0], "PRR")?;
                let d = self
                    .open
                    .remove(&(body[0], body[1]))
                    .ok_or("PRR has no matching PIR.")?;
                let (_, v) = fields::decoded(record, order)?;
                let n = |s: &str| v[s].as_i64().unwrap_or(0);
                self.output.push_back(Row::Device((
                    d.id,
                    body[0],
                    body[1],
                    seq,
                    body[2],
                    n("NUM_TEST") as u16,
                    n("HARD_BIN") as u16,
                    n("SOFT_BIN") as u16,
                    n("X_COORD") as i16,
                    n("Y_COORD") as i16,
                    n("TEST_T") as u32,
                    v["PART_ID"].as_str().unwrap_or("").into(),
                    v["PART_TXT"].as_str().unwrap_or("").into(),
                    d.wafer,
                )));
                self.devices += 1;
                self.sections.clear();
                return Ok(());
            }
            _ => {}
        }
        let (name, mut value) = fields::decoded(record, order)?;
        match (typ, sub) {
            (2, 10) => {
                let head = value["HEAD_NUM"].as_u64().unwrap_or(0) as u8;
                self.wafers.insert(head, seq);
            }
            (2, 20) => {
                let head = value["HEAD_NUM"].as_u64().unwrap_or(0) as u8;
                value["VIEWER_WIR_SEQ"] = json!(self.wafers.get(&head));
                self.wafers.remove(&head);
            }
            (50, 10) | (50, 30) => {
                // A datalog record has no head/site; do not invent one owning DUT in multisite data.
                let mut active: Vec<_> = self.open.values().map(|d| d.id).collect();
                active.sort_unstable();
                value["VIEWER_ACTIVE_DEVICES"] = json!(active);
            }
            (20, 10) => {
                if self.sections.len() >= 256 {
                    return Err("METADATA_LIMIT: program section nesting exceeds 256.".into());
                }
                self.sections
                    .push(value["SEQ_NAME"].as_str().unwrap_or("").into());
            }
            (20, 20) => {
                if self.sections.pop().is_none() {
                    self.warn("EPS without matching BPS.".into());
                }
            }
            _ => {}
        }
        if name != "UNKNOWN" {
            self.cold(seq, typ, sub, None, value);
        }
        Ok(())
    }
    fn test_record(
        &mut self,
        seq: u64,
        family: u8,
        body: &[u8],
        order: ByteOrder,
    ) -> Result<(), String> {
        if !self.has_mir {
            return Err("Test precedes MIR.".into());
        }
        let l = fields::layout(body, family, order)?;
        let head = body[4];
        let site = body[5];
        let flags = body[6];
        let number = uint32(body, order);
        let device = self.open.get(&(head, site)).map(|d| d.id);
        let defaults_only = device.is_none() && family == 10 && flags & 0x10 != 0 && body[7] == 0;
        if device.is_none() && !defaults_only {
            return Err("Test has no matching open PIR.".into());
        }
        let explicit = fields::text_field(body, &l, "TEST_TXT");
        let mut warnings = vec![];
        let (name, key_name) = if let Some(s) = explicit {
            (s.clone(), Name::Present(s))
        } else {
            let known = self.names.get(&(family, number));
            if let Some(ids) = known.filter(|ids| ids.len() == 1) {
                // A unique known identity can be referenced without copying its name.
                let id = ids[0];
                return self.emit_test(
                    seq,
                    family,
                    number,
                    head,
                    site,
                    flags,
                    device,
                    defaults_only,
                    body,
                    &l,
                    order,
                    id,
                    false,
                    &[],
                );
            }
            let ambiguous = known.is_some_and(|ids| ids.len() > 1);
            let warning = if ambiguous {
                "Ambiguous omitted TEST_TXT: separate unresolved identity."
            } else {
                "Omitted TEST_TXT has no preceding named identity."
            };
            warnings.push(warning.into());
            self.warn(format!("{family}/{number}: {warning}"));
            (
                if ambiguous {
                    "[unresolved TEST_TXT]"
                } else {
                    "[omitted TEST_TXT]"
                }
                .into(),
                if ambiguous {
                    Name::Ambiguous
                } else {
                    Name::Omitted
                },
            )
        };
        let key = (family, number, key_name.clone());
        let (id, new) = if let Some(&id) = self.identities.get(&key) {
            (id, false)
        } else {
            if self.tests.len() >= MAX_DEFINITIONS {
                return Err("METADATA_LIMIT: more than 20,000 test identities.".into());
            }
            let id = self.tests.len() as u32 + 1;
            self.tests.push(Test {
                defaults: Effective::default(),
            });
            self.identities.insert(key, id);
            if matches!(key_name, Name::Present(_)) {
                self.names.entry((family, number)).or_default().push(id);
            }
            (id, true)
        };
        self.emit_test(
            seq,
            family,
            number,
            head,
            site,
            flags,
            device,
            defaults_only,
            body,
            &l,
            order,
            id,
            new,
            &warnings,
        )?;
        if new {
            // The declaration was enqueued first; use its exact JSON for the test's default metadata.
            let metadata = self
                .output
                .iter()
                .rev()
                .find_map(|row| match row {
                    Row::Metadata(r) if r.0 == seq => Some(r.5.clone()),
                    _ => None,
                })
                .unwrap();
            self.output
                .push_front(Row::Test((id, family, number, name, seq, metadata)));
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn emit_test(
        &mut self,
        seq: u64,
        family: u8,
        _number: u32,
        head: u8,
        site: u8,
        flags: u8,
        device: Option<u64>,
        defaults_only: bool,
        body: &[u8],
        l: &Layout,
        order: ByteOrder,
        id: u32,
        new: bool,
        warnings: &[String],
    ) -> Result<(), String> {
        let section = self.sections.join(";");
        let mut tail = body[l.tail..].to_vec();
        if family == 15 {
            tail.extend_from_slice(&body[8..12]);
        }
        if family == 20 {
            for name in ["OPT_FLAG", "RTN_ICNT", "PGM_ICNT", "RTN_INDX", "PGM_INDX"] {
                if let Some(&(p, n)) = l.fields.get(name) {
                    tail.extend_from_slice(&(n as u32).to_le_bytes());
                    tail.extend_from_slice(&body[p..p + n]);
                } else {
                    tail.extend_from_slice(&0_u32.to_le_bytes());
                }
            }
        }
        let key = (id, section.clone(), tail);
        let declaration = if let Some(d) = self.declarations.get(&key) {
            Arc::clone(d)
        } else {
            if self.declarations.len() >= MAX_DEFINITIONS {
                return Err("METADATA_LIMIT: more than 20,000 viewer declarations.".into());
            }
            let e = fields::effective(
                body,
                l,
                family,
                order,
                (!new).then(|| &self.tests[id as usize - 1].defaults),
                &section,
            );
            let metadata = fields::declaration(body, l, order, &e, warnings);
            let cost = metadata.len() * 2
                + key.1.len()
                + key.2.len()
                + e.pin_indices.len() * 4
                + e.unit.len() * 2
                + 512;
            if self.metadata_bytes + cost > MAX_DEFINITION_BYTES {
                return Err("METADATA_LIMIT: viewer declaration state exceeds 16 MiB.".into());
            }
            self.metadata_bytes += cost;
            if new {
                self.tests[id as usize - 1].defaults = e.clone();
            }
            let d = Arc::new(Declaration {
                id: seq,
                test_id: id,
                effective: e,
            });
            self.declarations.insert(key, Arc::clone(&d));
            self.output
                .push_back(Row::Metadata((seq, seq, 15, family, device, metadata)));
            self.metadata += 1;
            d
        };
        if defaults_only {
            return Ok(());
        }
        let e = &declaration.effective;
        for ordinal in 0..l.result_count.max(1) {
            let bits = (ordinal < l.result_count)
                .then(|| uint32(&body[l.result_start + ordinal * 4..], order));
            let value = bits.and_then(fields::finite);
            let pmr = if family == 15 && e.pin_indices.len() == l.result_count {
                e.pin_indices.get(ordinal).copied()
            } else {
                None
            };
            self.output.push_back(Row::Observation((
                seq,
                ordinal as u32,
                device.unwrap(),
                declaration.test_id,
                head,
                site,
                flags,
                (family != 20).then(|| body[7]),
                bits,
                value,
                value,
                e.low,
                e.high,
                declaration.id,
                e.unit.clone(),
                pmr,
            )));
            self.observations += 1;
        }
        for (role, index_name, state_name) in [
            ("RTN", "RTN_INDX", "RTN_STAT"),
            ("PGM", "PGM_INDX", "PGM_STAT"),
        ] {
            let indices = fields::indexes(body, l, index_name, order).unwrap_or_else(|| {
                if role == "RTN" {
                    e.pin_indices.clone()
                } else {
                    vec![]
                }
            });
            let count = if role == "RTN" {
                l.return_count
            } else {
                indices.len()
            };
            for ordinal in 0..count {
                let state = l
                    .fields
                    .get(state_name)
                    .map(|&(p, _)| (body[p + ordinal / 2] >> (4 * (ordinal % 2))) & 15);
                self.output.push_back(Row::Pin((
                    seq,
                    role,
                    ordinal as u32,
                    indices.get(ordinal).copied(),
                    state,
                )));
            }
        }
        Ok(())
    }
    pub fn finish(&mut self) -> Result<Value, String> {
        if self.closed {
            return Err("Viewer parser is closed.".into());
        }
        if self.pending() {
            return Err("Drain pending viewer output before finish.".into());
        }
        self.closed = true;
        if self.input_pos != self.input.len() || self.order.is_none() {
            return Err("Truncated STDF record at end of source.".into());
        }
        if !self.has_mir || !self.has_mrr || !self.open.is_empty() {
            return Err("Incomplete source: require MIR, final MRR and matched PIR/PRR.".into());
        }
        Ok(
            json!({"version":1,"parserVersion":"viewer-v1","bytes":self.received,"records":self.records,
            "tests":self.tests.len(),"observations":self.observations,"devices":self.devices,"metadata":self.metadata,
            "byteOrder":if self.order==Some(ByteOrder::LittleEndian){"little"}else{"big"},"recordCounts":self.counts,"warnings":self.warnings}),
        )
    }
}

pub fn decode_record_native(bytes: &[u8], byte_order: &str) -> Result<String, String> {
    let order = match byte_order {
        "little" => ByteOrder::LittleEndian,
        "big" => ByteOrder::BigEndian,
        _ => return Err("byteOrder must be little or big.".into()),
    };
    if bytes.len() < 4 || bytes.len() != uint16(bytes, order) as usize + 4 {
        return Err("Supply exactly one complete framed STDF record.".into());
    }
    let (name, fields) = fields::decoded(bytes, order)?;
    Ok(json!({"type":bytes[2],"subtype":bytes[3],"name":name,"fields":fields}).to_string())
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::*;
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    pub struct ViewerParser(ViewerEngine);
    fn js<T: Serialize>(result: Result<T, String>) -> Result<String, JsValue> {
        result
            .and_then(|v| serde_json::to_string(&v).map_err(|e| e.to_string()))
            .map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen]
    impl ViewerParser {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self(ViewerEngine::default())
        }
        pub fn push(&mut self, bytes: &[u8]) -> Result<String, JsValue> {
            js(self.0.push(bytes))
        }
        pub fn drain(&mut self) -> Result<String, JsValue> {
            js(self.0.drain())
        }
        pub fn finish(&mut self) -> Result<String, JsValue> {
            js(self.0.finish())
        }
        pub fn memory_bytes(&self) -> usize {
            core::arch::wasm32::memory_size(0) * 65536
        }
    }
    #[wasm_bindgen]
    pub fn decode_record(bytes: &[u8], byte_order: &str) -> Result<String, JsValue> {
        decode_record_native(bytes, byte_order).map_err(|e| JsValue::from_str(&e))
    }
}
