use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub fn port(value: Option<&str>) -> Result<u16, String> {
    let port = value
        .unwrap_or("19000")
        .parse::<u16>()
        .map_err(|_| "Invalid STAR_BACKEND_PORT")?;
    if port == 0 {
        return Err("Invalid STAR_BACKEND_PORT".into());
    }
    Ok(port)
}

pub fn read_json(port: u16, path: &str) -> Result<serde_json::Value, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&address, Duration::from_millis(500))
        .map_err(|e| format!("backend connect: {e}"))?;
    read_response(stream, port, path)
}

fn read_response(
    mut stream: TcpStream,
    port: u16,
    path: &str,
) -> Result<serde_json::Value, String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(1200)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(1200)))
        .map_err(|e| e.to_string())?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|e| format!("backend write: {e}"))?;
    let mut raw = String::new();
    stream
        .take(65537)
        .read_to_string(&mut raw)
        .map_err(|e| format!("backend read: {e}"))?;
    if raw.len() > 65536 {
        return Err("Backend response too large".into());
    }
    let (header, body) = raw
        .split_once("\r\n\r\n")
        .ok_or("Invalid backend HTTP response")?;
    if header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        != Some("200")
    {
        return Err("Backend returned an HTTP error".into());
    }
    serde_json::from_str(body).map_err(|e| format!("backend json: {e}"))
}

pub fn ready(port: u16) -> Result<bool, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = match TcpStream::connect_timeout(&address, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::TimedOut
                    | std::io::ErrorKind::WouldBlock
            ) =>
        {
            return Ok(false)
        }
        Err(e) => return Err(format!("Cannot connect to backend: {e}")),
    };
    let data = read_response(stream, port, "/health")?;
    if data["status"] != "ok" || data["service"] != "star-office-ui" {
        return Err(format!(
            "Port {port} is occupied by another service; choose another STAR_BACKEND_PORT"
        ));
    }
    Ok(true)
}

fn wait_ready(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("Python exited before backend was ready: {status}"));
        }
        if ready(port)? {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(());
            }
            return Err("Python exited before backend was ready".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("Backend not ready within 20s".into())
}

pub fn start(root: &Path, port: u16) -> Result<Option<Child>, String> {
    if ready(port)? {
        return Ok(None);
    }
    let script = root.join("backend").join("app.py");
    if !script.exists() {
        return Err(format!("Backend script not found: {}", script.display()));
    }
    let mut candidates = Vec::new();
    if let Some(python) = std::env::var_os("STAR_BACKEND_PYTHON") {
        candidates.push(PathBuf::from(python));
    }
    #[cfg(windows)]
    candidates.push(root.join(".venv").join("Scripts").join("python.exe"));
    #[cfg(not(windows))]
    candidates.push(root.join(".venv").join("bin").join("python"));
    candidates.extend([PathBuf::from("python3"), PathBuf::from("python")]);
    for python in candidates {
        let mut command = Command::new(&python);
        command
            .arg(&script)
            .current_dir(root)
            .env("STAR_BACKEND_PORT", port.to_string())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.spawn() {
            Ok(mut child) => match wait_ready(&mut child, port, Duration::from_secs(20)) {
                Ok(()) => return Ok(Some(child)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("Failed to start {}: {error}", python.display());
                }
            },
            Err(error) => eprintln!("Failed to spawn {}: {error}", python.display()),
        }
    }
    Err("Cannot start STAR OFFICE backend. Check Python and backend/requirements.txt.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn validates_port() {
        assert_eq!(port(None).unwrap(), 19000);
        assert_eq!(port(Some("19123")).unwrap(), 19123);
        for invalid in ["0", "65536", "3.5", "bad"] {
            assert!(port(Some(invalid)).is_err());
        }
    }

    fn server(body: &'static str, status: u16) -> (u16, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let mut received = Vec::new();
            while !received.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let count = stream.read(&mut request).unwrap();
                assert!(count > 0);
                received.extend_from_slice(&request[..count]);
            }
            write!(stream, "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        (port, worker)
    }

    #[test]
    fn health_checks_service_and_http_status_on_configured_port() {
        for (body, status, valid) in [
            (r#"{"status":"ok","service":"star-office-ui"}"#, 200, true),
            (r#"{"status":"ok","service":"other"}"#, 200, false),
            (r#"{"status":"ok","service":"star-office-ui"}"#, 503, false),
            ("not json", 200, false),
        ] {
            let (port, worker) = server(body, status);
            let result = ready(port);
            assert_eq!(result.is_ok(), valid, "{result:?}");
            worker.join().unwrap();
        }
    }

    #[test]
    fn detects_early_python_exit_without_waiting_for_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        #[cfg(windows)]
        let mut child = Command::new("cmd").args(["/C", "exit 7"]).spawn().unwrap();
        #[cfg(not(windows))]
        let mut child = Command::new("sh").args(["-c", "exit 7"]).spawn().unwrap();
        let began = Instant::now();
        let result = wait_ready(&mut child, port, Duration::from_secs(20));
        assert!(
            result.as_ref().unwrap_err().contains("Python exited"),
            "{result:?}"
        );
        assert!(began.elapsed() < Duration::from_secs(5));
        child.wait().unwrap();
    }
}
