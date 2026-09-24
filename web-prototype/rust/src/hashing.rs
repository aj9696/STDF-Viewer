//! Incremental source identity without a whole-file allocation.
use sha2::{Digest, Sha256};

pub struct IncrementalHash(Option<Sha256>);

impl Default for IncrementalHash {
    fn default() -> Self {
        Self::new()
    }
}

impl IncrementalHash {
    pub fn new() -> Self {
        Self(Some(Sha256::new()))
    }

    pub fn update(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.0.as_mut().ok_or("Hasher is closed.")?.update(bytes);
        Ok(())
    }

    pub fn finish(&mut self) -> Result<String, String> {
        let digest = self.0.take().ok_or("Hasher is closed.")?.finalize();
        Ok(hex_bytes(&digest))
    }
}

pub(crate) fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 15)]));
    }
    encoded
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::IncrementalHash;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct Sha256Hasher(IncrementalHash);

    #[wasm_bindgen]
    impl Sha256Hasher {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self(IncrementalHash::new())
        }
        pub fn update(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
            self.0.update(bytes).map_err(|e| JsValue::from_str(&e))
        }
        pub fn finish(&mut self) -> Result<String, JsValue> {
            self.0.finish().map_err(|e| JsValue::from_str(&e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IncrementalHash;

    #[test]
    fn published_sha256_vectors_and_closed_state() {
        let mut hash = IncrementalHash::new();
        assert_eq!(
            hash.finish().unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert!(hash.update(b"a").is_err());
        assert!(hash.finish().is_err());
        let mut hash = IncrementalHash::new();
        for chunk in [b"a".as_slice(), b"bc"] {
            hash.update(chunk).unwrap();
        }
        assert_eq!(
            hash.finish().unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let mut hash = IncrementalHash::new();
        for _ in 0..1000 {
            hash.update(&[b'a'; 1000]).unwrap();
        }
        assert_eq!(
            hash.finish().unwrap(),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }
}
