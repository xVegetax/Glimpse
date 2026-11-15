use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::time::Duration;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[tauri::command]
pub async fn send_image_to_phone(png_bytes: Vec<u8>, upload_token: String) -> Result<(), String> {
    if png_bytes.is_empty() || png_bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image must be between 1 byte and 10 MB".to_string());
    }
    if upload_token.len() != 48 || !upload_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid mobile upload token".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || send_image(png_bytes, upload_token))
        .await
        .map_err(|error| format!("Mobile transfer task failed: {error}"))?
}

fn send_image(png_bytes: Vec<u8>, upload_token: String) -> Result<(), String> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 8765);
    let mut stream = TcpStream::connect_timeout(&address.into(), Duration::from_secs(3))
        .map_err(|error| format!("Mobile server unavailable: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;

    write!(
        stream,
        "POST /api/v1/image HTTP/1.1\r\nHost: localhost:8765\r\nAuthorization: Bearer {upload_token}\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        png_bytes.len()
    )
    .and_then(|_| stream.write_all(&png_bytes))
    .map_err(|error| format!("Could not send image: {error}"))?;

    let mut status = String::new();
    BufReader::new(stream)
        .read_line(&mut status)
        .map_err(|error| format!("Could not read mobile server response: {error}"))?;
    if status.starts_with("HTTP/1.1 201 ") || status.starts_with("HTTP/1.0 201 ") {
        return Ok(());
    }
    if status.contains(" 401 ") {
        return Err("Mobile upload token expired. Enter the new token.".to_string());
    }
    Err(format!("Mobile server rejected image: {}", status.trim()))
}
