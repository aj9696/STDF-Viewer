//! Physical field presence and independent STDF default/display interpretation.
use crate::hashing::hex_bytes;
use crate::retained_fields::{uint16, uint32};
use rust_stdf::{ByteOrder, StdfRecord};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

#[derive(Default)]
pub(crate) struct Layout {
    pub tail: usize,
    pub result_start: usize,
    pub result_count: usize,
    pub return_count: usize,
    pub fields: BTreeMap<&'static str, (usize, usize)>,
}

struct Cursor<'a> {
    body: &'a [u8],
    pos: usize,
    fields: BTreeMap<&'static str, (usize, usize)>,
}
impl Cursor<'_> {
    fn field(&mut self, name: &'static str, width: usize) -> Result<(), String> {
        if self.pos == self.body.len() {
            return Ok(());
        }
        let size = if width == 0 {
            1 + self.body[self.pos] as usize
        } else {
            width
        };
        if self.pos + size > self.body.len() {
            return Err(format!("Record ends inside {name}."));
        }
        self.fields.insert(name, (self.pos, size));
        self.pos += size;
        Ok(())
    }
    fn array(&mut self, name: &'static str, size: usize, required: bool) -> Result<(), String> {
        if size == 0 {
            return Ok(());
        }
        if self.pos == self.body.len() && !required {
            return Ok(());
        }
        if self.pos + size > self.body.len() {
            return Err(format!("Record ends inside {name}."));
        }
        self.fields.insert(name, (self.pos, size));
        self.pos += size;
        Ok(())
    }
    fn bits(&mut self, name: &'static str, order: ByteOrder) -> Result<(), String> {
        if self.pos == self.body.len() {
            return Ok(());
        }
        if self.pos + 2 > self.body.len() {
            return Err(format!("Record ends inside {name}."));
        }
        let n = uint16(&self.body[self.pos..], order) as usize;
        self.array(name, 2 + n.div_ceil(8), true)
    }
    fn count(&self, field: &str, order: ByteOrder) -> usize {
        self.fields
            .get(field)
            .map(|&(p, _)| uint16(&self.body[p..], order) as usize)
            .unwrap_or(0)
    }
}

pub(crate) fn layout(body: &[u8], family: u8, order: ByteOrder) -> Result<Layout, String> {
    let min = if family == 20 { 7 } else { 12 };
    if body.len() < min {
        return Err("Test record has incomplete mandatory fields.".into());
    }
    let mut out = Layout::default();
    let mut c = Cursor {
        body,
        pos: min,
        fields: BTreeMap::new(),
    };
    if family == 20 {
        for (name, width) in [
            ("OPT_FLAG", 1),
            ("CYCL_CNT", 4),
            ("REL_VADR", 4),
            ("REPT_CNT", 4),
            ("NUM_FAIL", 4),
            ("XFAIL_AD", 4),
            ("YFAIL_AD", 4),
            ("VECT_OFF", 2),
            ("RTN_ICNT", 2),
            ("PGM_ICNT", 2),
        ] {
            c.field(name, width)?;
        }
        let rtn = c.count("RTN_ICNT", order);
        let pgm = c.count("PGM_ICNT", order);
        c.array("RTN_INDX", rtn * 2, rtn > 0)?;
        c.array("RTN_STAT", rtn.div_ceil(2), rtn > 0)?;
        c.array("PGM_INDX", pgm * 2, pgm > 0)?;
        c.array("PGM_STAT", pgm.div_ceil(2), pgm > 0)?;
        c.bits("FAIL_PIN", order)?;
        out.tail = c.pos;
        for name in [
            "VECT_NAM", "TIME_SET", "OP_CODE", "TEST_TXT", "ALARM_ID", "PROG_TXT", "RSLT_TXT",
        ] {
            c.field(name, 0)?;
        }
        c.field("PATG_NUM", 1)?;
        c.bits("SPIN_MAP", order)?;
        out.return_count = rtn;
    } else {
        if family == 15 {
            out.return_count = uint16(&body[8..], order) as usize;
            out.result_count = uint16(&body[10..], order) as usize;
            c.array(
                "RTN_STAT",
                out.return_count.div_ceil(2),
                out.return_count > 0,
            )?;
            out.result_start = c.pos;
            c.array("RTN_RSLT", out.result_count * 4, out.result_count > 0)?;
        } else {
            out.result_start = 8;
            out.result_count = 1;
        }
        out.tail = c.pos;
        for (name, width) in [
            ("TEST_TXT", 0),
            ("ALARM_ID", 0),
            ("OPT_FLAG", 1),
            ("RES_SCAL", 1),
            ("LLM_SCAL", 1),
            ("HLM_SCAL", 1),
            ("LO_LIMIT", 4),
            ("HI_LIMIT", 4),
        ] {
            c.field(name, width)?;
        }
        if family == 15 {
            c.field("START_IN", 4)?;
            c.field("INCR_IN", 4)?;
            c.array("RTN_INDX", out.return_count * 2, false)?;
        }
        c.field("UNITS", 0)?;
        if family == 15 {
            c.field("UNITS_IN", 0)?;
        }
        for name in ["C_RESFMT", "C_LLMFMT", "C_HLMFMT"] {
            c.field(name, 0)?;
        }
        c.field("LO_SPEC", 4)?;
        c.field("HI_SPEC", 4)?;
    }
    if c.pos != body.len() {
        return Err("Test record has trailing bytes outside v4 fields.".into());
    }
    out.fields = c.fields;
    Ok(out)
}

pub(crate) fn text_field(body: &[u8], l: &Layout, name: &str) -> Option<String> {
    l.fields
        .get(name)
        .map(|&(p, n)| String::from_utf8_lossy(&body[p + 1..p + n]).into_owned())
}
pub(crate) fn indexes(body: &[u8], l: &Layout, name: &str, order: ByteOrder) -> Option<Vec<u16>> {
    l.fields.get(name).map(|&(p, n)| {
        body[p..p + n]
            .chunks_exact(2)
            .map(|b| uint16(b, order))
            .collect()
    })
}
fn float_field(body: &[u8], l: &Layout, name: &str, order: ByteOrder) -> Option<f64> {
    l.fields
        .get(name)
        .and_then(|&(p, _)| finite(uint32(&body[p..], order)))
}
pub(crate) fn finite(bits: u32) -> Option<f64> {
    let f = f32::from_bits(bits);
    f.is_finite().then_some(f as f64)
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Effective {
    pub unit: String,
    pub scale: i8,
    pub low_scale: i8,
    pub high_scale: i8,
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub low_spec: Option<f64>,
    pub high_spec: Option<f64>,
    pub pin_indices: Vec<u16>,
    pub pattern: String,
    pub section: String,
    pub start_in: Option<f64>,
    pub incr_in: Option<f64>,
    pub input_unit: String,
}
fn string_default(value: Option<String>, fallback: &str) -> String {
    match value.as_deref() {
        None | Some("") => fallback.into(),
        Some("\0") => String::new(),
        Some(s) => s.into(),
    }
}
pub(crate) fn effective(
    body: &[u8],
    l: &Layout,
    family: u8,
    order: ByteOrder,
    default: Option<&Effective>,
    section: &str,
) -> Effective {
    let empty = Effective::default();
    let d = default.unwrap_or(&empty);
    let mut e = d.clone();
    e.section = section.into();
    e.pattern = string_default(text_field(body, l, "VECT_NAM"), &d.pattern);
    e.pin_indices = indexes(body, l, "RTN_INDX", order).unwrap_or_else(|| d.pin_indices.clone());
    if family == 20 {
        return e;
    }
    let opt = l.fields.get("OPT_FLAG").map(|&(p, _)| body[p]);
    let opt = opt.unwrap_or(if default.is_some() { 0x31 } else { 0xff });
    let signed = |field: &str, fallback| {
        l.fields
            .get(field)
            .map(|&(p, _)| body[p] as i8)
            .unwrap_or(fallback)
    };
    if opt & 1 == 0 {
        e.scale = signed("RES_SCAL", d.scale);
    }
    if opt & 0x40 != 0 {
        e.low = None;
    } else if opt & 0x10 == 0 {
        e.low = if l.fields.contains_key("LO_LIMIT") {
            float_field(body, l, "LO_LIMIT", order)
        } else {
            d.low
        };
        e.low_scale = signed("LLM_SCAL", d.low_scale);
    }
    if opt & 0x80 != 0 {
        e.high = None;
    } else if opt & 0x20 == 0 {
        e.high = if l.fields.contains_key("HI_LIMIT") {
            float_field(body, l, "HI_LIMIT", order)
        } else {
            d.high
        };
        e.high_scale = signed("HLM_SCAL", d.high_scale);
    }
    // Specifications belong to the initial declaration, not later local overrides.
    if default.is_none() {
        e.low_spec = if opt & 4 == 0 {
            float_field(body, l, "LO_SPEC", order)
        } else {
            None
        };
        e.high_spec = if opt & 8 == 0 {
            float_field(body, l, "HI_SPEC", order)
        } else {
            None
        };
    }
    e.unit = string_default(text_field(body, l, "UNITS"), &d.unit);
    if family == 15 {
        if opt & 2 == 0 {
            e.start_in = float_field(body, l, "START_IN", order).or(d.start_in);
            e.incr_in = float_field(body, l, "INCR_IN", order).or(d.incr_in);
        }
        e.input_unit = string_default(text_field(body, l, "UNITS_IN"), &d.input_unit);
    }
    e
}

pub(crate) fn declaration(
    body: &[u8],
    l: &Layout,
    order: ByteOrder,
    e: &Effective,
    warnings: &[String],
) -> String {
    let mut raw = Map::new();
    for (&name, &(p, n)) in &l.fields {
        if matches!(name, "RTN_STAT" | "RTN_RSLT" | "PGM_STAT") {
            continue;
        }
        raw.insert(
            name.into(),
            json!({"offset":p,"hex":hex_bytes(&body[p..p+n])}),
        );
        if matches!(
            name,
            "LO_LIMIT" | "HI_LIMIT" | "LO_SPEC" | "HI_SPEC" | "START_IN" | "INCR_IN"
        ) {
            raw.insert(format!("{name}_BITS"), uint32(&body[p..], order).into());
        }
    }
    let identity = if warnings.iter().any(|w| w.starts_with("Ambiguous")) {
        "unresolved-ambiguous"
    } else if warnings.iter().any(|w| w.starts_with("Omitted")) {
        "unresolved-omitted"
    } else {
        "resolved"
    };
    json!({"identity":identity,"raw":raw,"presentFields":l.fields.keys().filter(|&&s| !matches!(s,"RTN_STAT"|"RTN_RSLT"|"PGM_STAT")).collect::<Vec<_>>(),
        "rawTailHex":hex_bytes(&body[l.tail..]),"warnings":warnings,"effective":e}).to_string()
}

pub(crate) fn decoded(bytes: &[u8], order: ByteOrder) -> Result<(&'static str, Value), String> {
    let rec = StdfRecord::read_from_bytes_with_header(bytes, &order).map_err(|e| e.to_string())?;
    macro_rules! convert { ($($kind:ident),*) => { match rec {
        $(StdfRecord::$kind(v) => Ok((stringify!($kind),serde_json::to_value(v).map_err(|e| e.to_string())?)),)*
        _ => Ok(("UNKNOWN",json!({"RAW_HEX":hex_bytes(&bytes[4..])})))
    } }; }
    convert!(
        FAR, ATR, VUR, MIR, MRR, PCR, HBR, SBR, PMR, PGR, PLR, RDR, SDR, WIR, WRR, WCR, PIR, PRR,
        TSR, PTR, MPR, FTR, BPS, EPS, GDR, DTR, STR, PSR, NMR, CNR, SSR, CDR
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_variable_fields_reject() {
        let mut b = vec![0; 12];
        b.extend([3, b'x']);
        assert!(layout(&b, 10, ByteOrder::LittleEndian).is_err());
        assert!(layout(&[0; 7], 20, ByteOrder::LittleEndian).is_ok());
    }
    #[test]
    fn explicit_empty_and_clear_default_strings_differ() {
        assert_eq!(string_default(Some("".into()), "V"), "V");
        assert_eq!(string_default(Some("\0".into()), "V"), "");
    }
}
