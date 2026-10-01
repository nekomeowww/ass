use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

pub(super) fn decode_base64(value: &str) -> Result<Vec<u8>, base64::DecodeError> {
    BASE64.decode(value)
}

pub(super) fn encode_base64(value: impl AsRef<[u8]>) -> String {
    BASE64.encode(value)
}
