use mdns_sd::{ServiceDaemon, ServiceInfo};
use qrcode::QrCode;
use qrcode::render::svg;
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use windows::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const SHARE_PORT: u16 = 8766;
const CONNECTED_TIMEOUT: Duration = Duration::from_secs(12);
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Default)]
pub struct MobileShareState(Mutex<Option<Arc<ActiveShare>>>);

struct ActiveShare {
    image: Mutex<Vec<u8>>,
    revision: AtomicU64,
    last_seen: Mutex<Option<Instant>>,
    stopped: AtomicBool,
    token: String,
    info: MobileShareInfo,
    mdns: Option<ServiceDaemon>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileShareInfo {
    url: String,
    qr_svg: String,
    fallback_url: Option<String>,
    fallback_qr_svg: Option<String>,
}

#[derive(Serialize)]
pub struct MobileShareStatus {
    active: bool,
    connected: bool,
}

#[tauri::command]
pub async fn start_mobile_share(
    png_bytes: Vec<u8>,
    state: State<'_, MobileShareState>,
) -> Result<MobileShareInfo, String> {
    if png_bytes.len() < PNG_SIGNATURE.len()
        || png_bytes.len() > MAX_IMAGE_BYTES
        || !png_bytes.starts_with(PNG_SIGNATURE)
    {
        return Err("Image must be a PNG smaller than 10 MB".into());
    }

    let mut current = state
        .0
        .lock()
        .map_err(|_| "Sharing state is unavailable".to_string())?;
    if let Some(active) = current.as_ref() {
        let mut image = active
            .image
            .lock()
            .map_err(|_| "Shared image is unavailable".to_string())?;
        *image = png_bytes;
        active.revision.fetch_add(1, Ordering::Relaxed);
        return Ok(active.info.clone());
    }

    let token = random_token()?;
    let ip = local_ipv4()?;
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, SHARE_PORT))
        .or_else(|_| TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)))
        .map_err(|error| format!("Could not start local sharing: {error}"))?;
    let port = listener
        .local_addr()
        .map(|addr| addr.port())
        .unwrap_or(SHARE_PORT);
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure local sharing: {error}"))?;
    let ip_url = format!("http://{ip}:{port}/?token={token}");
    let mdns = ServiceDaemon::new().ok().and_then(|daemon| {
        let service = ServiceInfo::new(
            "_http._tcp.local.",
            "Glimpse",
            "glimpse.local.",
            ip.to_string(),
            port,
            &[] as &[(&str, &str)],
        )
        .ok()?;
        if daemon.register(service).is_ok() {
            Some(daemon)
        } else {
            let _ = daemon.shutdown();
            None
        }
    });
    let url = if mdns.is_some() {
        format!("http://glimpse.local:{port}/?token={token}")
    } else {
        ip_url.clone()
    };
    let qr_svg = QrCode::new(url.as_bytes())
        .map_err(|error| format!("Could not generate QR code: {error}"))?
        .render::<svg::Color>()
        .min_dimensions(232, 232)
        .build();
    let fallback_qr_svg = if url != ip_url {
        Some(
            QrCode::new(ip_url.as_bytes())
                .map_err(|error| format!("Could not generate fallback QR code: {error}"))?
                .render::<svg::Color>()
                .min_dimensions(232, 232)
                .build(),
        )
    } else {
        None
    };
    let fallback_url = (url != ip_url).then_some(ip_url);
    let info = MobileShareInfo {
        url,
        qr_svg,
        fallback_url,
        fallback_qr_svg,
    };
    let active = Arc::new(ActiveShare {
        image: Mutex::new(png_bytes),
        revision: AtomicU64::new(1),
        last_seen: Mutex::new(None),
        stopped: AtomicBool::new(false),
        token,
        info: info.clone(),
        mdns,
    });
    *current = Some(Arc::clone(&active));
    std::thread::spawn(move || serve(listener, active));
    Ok(info)
}

#[tauri::command]
pub fn stop_mobile_share(state: State<'_, MobileShareState>) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "Sharing state is unavailable".to_string())?;
    if let Some(active) = current.take() {
        active.stopped.store(true, Ordering::Relaxed);
        if let Some(mdns) = &active.mdns {
            let _ = mdns.shutdown();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_mobile_share_status(
    state: State<'_, MobileShareState>,
) -> Result<MobileShareStatus, String> {
    let current = state
        .0
        .lock()
        .map_err(|_| "Sharing state is unavailable".to_string())?;
    let Some(active) = current.as_ref() else {
        return Ok(MobileShareStatus {
            active: false,
            connected: false,
        });
    };
    let connected = active
        .last_seen
        .lock()
        .map_err(|_| "Sharing status is unavailable".to_string())?
        .is_some_and(|seen| seen.elapsed() < CONNECTED_TIMEOUT);
    Ok(MobileShareStatus {
        active: true,
        connected,
    })
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 24];
    let status = unsafe { BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status.0 < 0 {
        return Err(format!("Could not create sharing token: {status:?}"));
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn local_ipv4() -> Result<Ipv4Addr, String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|error| format!("Could not find local network: {error}"))?;
    socket
        .connect(("192.0.2.1", 80))
        .map_err(|error| format!("Connect to Wi-Fi before sharing: {error}"))?;
    match socket.local_addr().map(|address| address.ip()) {
        Ok(std::net::IpAddr::V4(ip)) if !ip.is_loopback() => Ok(ip),
        _ => Err("No local IPv4 address is available for phone sharing".into()),
    }
}

fn serve(listener: TcpListener, active: Arc<ActiveShare>) {
    while !active.stopped.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => handle_client(stream, &active),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
}

fn handle_client(mut stream: TcpStream, active: &ActiveShare) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let mut request = [0_u8; 4096];
    let Ok(count) = stream.read(&mut request) else {
        return;
    };
    let Ok(first_line) = std::str::from_utf8(&request[..count]) else {
        return;
    };
    let Some(first_line) = first_line.lines().next() else {
        return;
    };
    let mut parts = first_line.split_whitespace();
    let (Some("GET"), Some(path), Some(_version)) = (parts.next(), parts.next(), parts.next())
    else {
        respond(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            b"Method not allowed",
        );
        return;
    };
    if active.stopped.load(Ordering::Relaxed) {
        return;
    }
    let Some((route, supplied_token)) = path.split_once("?token=") else {
        respond(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"Invalid share link",
        );
        return;
    };
    if supplied_token != active.token {
        respond(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"Invalid share link",
        );
        return;
    }
    if let Ok(mut last_seen) = active.last_seen.lock() {
        *last_seen = Some(Instant::now());
    }
    match route {
        "/icon.png" => respond(
            &mut stream,
            "200 OK",
            "image/png",
            include_bytes!("../icons/128x128.png"),
        ),
        "/" => {
            let page = PHONE_PAGE.replace("{{TOKEN}}", &active.token);
            respond(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                page.as_bytes(),
            );
        }
        "/status" => {
            let body = format!(
                "{{\"revision\":{}}}",
                active.revision.load(Ordering::Relaxed)
            );
            respond(&mut stream, "200 OK", "application/json", body.as_bytes());
        }
        "/image" => {
            if let Ok(image) = active.image.lock() {
                respond(&mut stream, "200 OK", "image/png", &image);
            }
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", b"Not found"),
    }
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

const PHONE_PAGE: &str = r##"<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer"><title>Glimpse — Capture</title>
<style>
:root{
  --bg:#0b0f17;
  --glass:rgba(255,255,255,.14);
  --glass-border:rgba(255,255,255,.26);
  --glass-highlight:rgba(255,255,255,.35);
  --text:#f5f5f7;
  --muted:rgba(245,245,247,.78);
  --success:#30d158;
  --danger:#ff453a;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif}
.stage{
  position:relative;
  width:100vw;
  height:100dvh;
  display:flex;
  align-items:center;
  justify-content:center;
  background:var(--bg);
}
#photo{
  width:100%;
  height:100%;
  object-fit:contain;
  display:block;
}
.top-bar{
  position:fixed;
  top:max(14px,env(safe-area-inset-top));
  left:14px;
  right:14px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  pointer-events:none;
  z-index:10;
}
.glass-pill{
  pointer-events:auto;
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 14px;
  border-radius:999px;
  background:var(--glass);
  backdrop-filter:blur(24px) saturate(180%);
  -webkit-backdrop-filter:blur(24px) saturate(180%);
  border:1px solid var(--glass-border);
  box-shadow:0 10px 30px rgba(0,0,0,.32),inset 0 1px 0 var(--glass-highlight);
}
.brand-logo{width:24px;height:24px;border-radius:7px;flex:0 0 24px}
.brand-name{font-size:15px;font-weight:600;letter-spacing:-.01em}
.status-text{font-size:13px;color:var(--muted)}
.status-dot{
  width:8px;
  height:8px;
  border-radius:999px;
  background:var(--danger);
  box-shadow:0 0 8px var(--danger);
  flex:0 0 8px;
}
.status-dot.connected{
  background:var(--success);
  box-shadow:0 0 8px var(--success);
}
.bottom-bar{
  position:fixed;
  left:16px;
  right:16px;
  bottom:max(20px,env(safe-area-inset-bottom));
  display:flex;
  justify-content:center;
  pointer-events:none;
  z-index:10;
}
#download{
  pointer-events:auto;
  width:100%;
  max-width:420px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:15px 24px;
  border-radius:999px;
  background:rgba(255,255,255,.16);
  backdrop-filter:blur(26px) saturate(180%);
  -webkit-backdrop-filter:blur(26px) saturate(180%);
  border:1px solid rgba(255,255,255,.3);
  box-shadow:0 14px 36px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.4);
  color:#fff;
  font:600 16px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
  text-decoration:none;
  transition:transform .12s ease,background .15s ease;
}
#download:active{transform:scale(.97);background:rgba(255,255,255,.24)}
</style>
</head><body>
<div class="stage">
  <img id="photo" alt="Capture reçue depuis Glimpse">
  <header class="top-bar">
    <div class="glass-pill">
      <img class="brand-logo" src="/icon.png?token={{TOKEN}}" alt="Glimpse">
      <span class="brand-name">Glimpse</span>
    </div>
    <div class="glass-pill">
      <span id="status-dot" class="status-dot"></span>
      <span id="status" class="status-text">Connexion…</span>
    </div>
  </header>
  <div class="bottom-bar">
    <a id="download" href="/image?token={{TOKEN}}" download="glimpse-capture.png">Télécharger la photo</a>
  </div>
</div>
<script>
const statusDot=document.getElementById('status-dot');
let revision=0,currentUrl=null;
async function poll(){
  try{
    const response=await fetch('/status?token={{TOKEN}}',{cache:'no-store'});
    if(!response.ok)throw new Error('Partage arrêté');
    const state=await response.json();
    if(state.revision!==revision){
      const image=await fetch('/image?token={{TOKEN}}',{cache:'no-store'});
      if(!image.ok)throw new Error('Image indisponible');
      const blob=await image.blob();
      const nextUrl=URL.createObjectURL(blob);
      const oldUrl=currentUrl;
      currentUrl=nextUrl;revision=state.revision;
      document.getElementById('photo').src=nextUrl;
      document.getElementById('download').href=nextUrl;
      if(oldUrl)URL.revokeObjectURL(oldUrl);
    }
    statusDot.classList.add('connected');
    document.getElementById('status').textContent='Connecté';
  }catch(error){
    statusDot.classList.remove('connected');
    document.getElementById('status').textContent='Déconnecté';
  }
  window.setTimeout(poll,2500);
}
poll();
document.getElementById('download').addEventListener('click',(e)=>{
  if(!currentUrl)return;
  e.preventDefault();
  const a=document.createElement('a');
  a.href=currentUrl;
  a.download='glimpse-capture.png';
  a.rel='noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
});
</script></body></html>"##;
