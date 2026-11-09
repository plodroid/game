// Google sign-in for the desktop app. Google refuses to sign people in inside embedded windows, so
// the sign-in happens in the player's normal browser and the result comes back here over loopback:
//   1. the game asks  POST /start  -> this opens the system browser on the game's sign-in page
//   2. that page signs in with Google and sends the credential to  POST /done
//   3. the game long-polls  GET /wait  and receives it
// Only the game's own origin may talk to it, and the server listens on 127.0.0.1 only. A forged
// credential is useless: Firebase verifies it with Google.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const PORT: u16 = 47831;
const ORIGIN: &str = "https://plodroid.github.io";
const SIGN_IN_PAGE: &str = "https://plodroid.github.io/game/?desktopAuth=47831";

type Slot = Arc<Mutex<Option<String>>>;

pub fn start() {
    let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)) else { return };
    let slot: Slot = Arc::new(Mutex::new(None));
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let slot = slot.clone();
            thread::spawn(move || handle(stream, slot));
        }
    });
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    let _ = url;
}

fn reply(s: &mut TcpStream, status: &str, origin: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nVary: Origin\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body.as_bytes());
}

fn handle(mut s: TcpStream, slot: Slot) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let (head_end, len) = loop {
        let Ok(n) = s.read(&mut tmp) else { return };
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.len() > 65536 {
            return;
        }
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..i]).to_lowercase();
            let len = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok()))
                .unwrap_or(0);
            break (i + 4, len);
        }
    };
    while buf.len() < head_end + len {
        let Ok(n) = s.read(&mut tmp) else { return };
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let body = String::from_utf8_lossy(&buf[head_end..buf.len().min(head_end + len)]).to_string();
    let first = head.lines().next().unwrap_or("");
    let origin = head
        .lines()
        .find_map(|l| l.to_lowercase().starts_with("origin:").then(|| l[7..].trim().to_string()))
        .unwrap_or_default();
    // The game (inside the app) and its sign-in page (in the browser) are both on the game's origin.
    if origin != ORIGIN {
        return reply(&mut s, "403 Forbidden", ORIGIN, "{}");
    }
    if first.starts_with("OPTIONS") {
        return reply(&mut s, "204 No Content", &origin, "");
    }
    if first.starts_with("POST /start") {
        *slot.lock().unwrap() = None;
        open_browser(SIGN_IN_PAGE);
        reply(&mut s, "200 OK", &origin, "{}");
    } else if first.starts_with("POST /done") {
        *slot.lock().unwrap() = Some(body);
        reply(&mut s, "200 OK", &origin, "{}");
    } else if first.starts_with("GET /wait") {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(25) {
            if let Some(v) = slot.lock().unwrap().take() {
                return reply(&mut s, "200 OK", &origin, &v);
            }
            thread::sleep(Duration::from_millis(200));
        }
        reply(&mut s, "204 No Content", &origin, "");
    } else {
        reply(&mut s, "404 Not Found", &origin, "{}");
    }
}
