use semidata_web_parser::{Engine, MAX_CHUNK_BYTES};
use std::{fs::File, io::Read};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("Usage: native FILE [CHUNK_BYTES]")?;
    let chunk: usize = std::env::args()
        .nth(2)
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(MAX_CHUNK_BYTES);
    if !(1..=MAX_CHUNK_BYTES).contains(&chunk) {
        return Err("Invalid chunk size".into());
    }
    let mut file = File::open(path)?;
    let mut buffer = vec![0; chunk];
    let mut engine = Engine::default();
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        engine.push(&buffer[..count])?;
    }
    println!("{}", serde_json::to_string(&engine.finish()?)?);
    Ok(())
}
