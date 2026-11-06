//! Temporary delegated sign-in using the installed Horizon launcher's public CLI.
//! Horizon owns OAuth grants; only its read-once Minecraft session crosses this bridge.
use aes_gcm::aead::{rand_core::RngCore, OsRng};
use base64::Engine as _;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const PREFIX: &str = "horizon:";
const FAILED: &str = "horizon_auth_failed";
const TTL: Duration = Duration::from_secs(15 * 60);

pub(super) fn enabled() -> bool {
    std::env::var("TURTLECLIENT_AUTH_PROVIDER").unwrap_or_else(|_| "horizon".into()) == "horizon"
}

#[derive(Clone)]
struct Backend {
    program: PathBuf,
    home: PathBuf,
}
impl Backend {
    fn find() -> Result<Self, String> {
        let program = match std::env::var_os("TURTLECLIENT_HORIZON_LAUNCHER") {
            Some(path) => PathBuf::from(path),
            None => {
                let file = if cfg!(windows) {
                    "horizon-launcher.exe"
                } else {
                    "horizon-launcher"
                };
                let mut paths = Vec::new();
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(parent) = exe.parent() {
                        paths.push(parent.join(file));
                    }
                }
                if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                    paths.push(
                        PathBuf::from(local)
                            .join("Programs/Horizon Launcher")
                            .join(file),
                    );
                }
                paths
                    .into_iter()
                    .find(|p| p.is_file())
                    .ok_or("horizon_auth_missing")?
            }
        };
        if !program.is_file() {
            return Err("horizon_auth_missing".into());
        }
        Ok(Self {
            program,
            home: crate::engine::data_dir().join("horizon-auth"),
        })
    }
    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(["--json", "account"])
            .args(args)
            .stdin(Stdio::null())
            .env("HORIZON_LAUNCHER_HOME", self.home.join("launcher"))
            .env("HORIZON_HOME", self.home.join("game"))
            .env("XDG_DATA_HOME", self.home.join("data"))
            .env("XDG_CONFIG_HOME", self.home.join("config"))
            .env("HORIZON_LAUNCHER_TRASH", self.home.join("trash"))
            .env("HORIZON_LAUNCHER_CLIPBOARD", self.home.join("clipboard"))
            .env("HORIZON_LAUNCHER_DESKTOP", self.home.join("desktop"))
            .env("HORIZON_LAUNCHER_NO_SELF_UPDATE", "1")
            .env("HORIZON_NO_AUDIO", "1");
        crate::engine::quiet(&mut cmd);
        cmd
    }
    fn run(&self, args: &[&str]) -> Result<Value, String> {
        let start = Instant::now();
        match crate::engine::output_unless_stopped(&mut self.command(args), || {
            crate::exiting() || start.elapsed() > Duration::from_secs(90)
        }) {
            Ok(crate::engine::Ran::Done(out)) if out.status.success() => {
                serde_json::from_slice(&out.stdout).map_err(|_| FAILED.into())
            }
            _ => Err(FAILED.into()),
        }
    }
    fn session(&self, uuid: &str) -> Result<Value, String> {
        let uuid = normalized_uuid(uuid).ok_or(FAILED)?;
        let answer = self.run(&["session", &uuid])?;
        if answer["authentication"]["state"] == "sign_in_required" {
            return Err("horizon_auth_relogin".into());
        }
        let path = answer["session_file"].as_str().ok_or(FAILED)?;
        consume_session(Path::new(path), &self.home.join("game/sessions"), &uuid)
    }
}

struct Flow {
    cancel: AtomicBool,
    child: Mutex<Option<Child>>,
    result: Mutex<Option<Result<Value, String>>>,
    started: Instant,
}
fn flows() -> &'static Mutex<HashMap<String, Arc<Flow>>> {
    static FLOWS: OnceLock<Mutex<HashMap<String, Arc<Flow>>>> = OnceLock::new();
    FLOWS.get_or_init(Default::default)
}
fn stop(flow: &Flow) {
    flow.cancel.store(true, Ordering::Relaxed);
    if let Some(child) = flow
        .child
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()
    {
        let _ = child.kill();
    }
}
pub fn cancel_horizon_signins() {
    for flow in flows().lock().unwrap_or_else(|e| e.into_inner()).values() {
        stop(flow);
    }
}
pub fn ms_device_cancel(handle: &str) {
    if let Some(flow) = flows()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(handle)
    {
        stop(&flow);
    }
}

pub(super) async fn start() -> Result<Value, String> {
    start_with(Backend::find()?).await
}

async fn start_with(backend: Backend) -> Result<Value, String> {
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let handle = format!(
        "{PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(nonce)
    );
    let flow = Arc::new(Flow {
        cancel: AtomicBool::new(false),
        child: Mutex::new(None),
        result: Mutex::new(None),
        started: Instant::now(),
    });
    {
        let mut map = flows().lock().unwrap_or_else(|e| e.into_inner());
        for old in map.values() {
            stop(old);
        }
        map.clear();
        map.insert(handle.clone(), flow.clone());
    }
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let answer = sign_in(&backend, &flow, send);
        *flow.result.lock().unwrap_or_else(|e| e.into_inner()) = Some(answer);
    });
    let code =
        tokio::task::spawn_blocking(move || receive.recv_timeout(Duration::from_secs(30))).await;
    match code {
        Ok(Ok((url, code))) => Ok(
            json!({"device_code":handle,"user_code":code,"verification_uri":url,"interval":1,"provider":"horizon"}),
        ),
        _ => {
            ms_device_cancel(&handle);
            Err(FAILED.into())
        }
    }
}
fn sign_in(
    backend: &Backend,
    flow: &Flow,
    code: mpsc::Sender<(String, String)>,
) -> Result<Value, String> {
    let mut child = backend
        .command(&["sign-in"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| FAILED)?;
    let stderr = child.stderr.take().ok_or(FAILED)?;
    *flow.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    let reader = std::thread::spawn(move || {
        let mut sent = false;
        for line in std::io::BufReader::new(stderr)
            .take(16 * 1024)
            .lines()
            .map_while(Result::ok)
        {
            if !sent {
                if let Some(prompt) = device_prompt(&line) {
                    let _ = code.send(prompt);
                    sent = true;
                }
            }
        }
    });
    let success = loop {
        if flow.cancel.load(Ordering::Relaxed) || flow.started.elapsed() > TTL || crate::exiting() {
            stop(flow);
            break false;
        }
        let done = flow
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .ok_or(FAILED)?
            .try_wait()
            .map_err(|_| FAILED)?;
        if let Some(status) = done {
            break status.success();
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    if let Some(mut child) = flow.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        if !success {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    let _ = reader.join();
    if !success || flow.cancel.load(Ordering::Relaxed) {
        return Err(FAILED.into());
    }
    let accounts = backend.run(&["list"])?;
    let selected = accounts["accounts"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["selected"] == true))
        .ok_or(FAILED)?;
    backend.session(selected["uuid"].as_str().ok_or(FAILED)?)
}
pub(super) fn poll(handle: &str) -> Result<Value, String> {
    let flow = flows()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(handle)
        .cloned()
        .ok_or(FAILED)?;
    if flow.started.elapsed() > TTL {
        ms_device_cancel(handle);
        return Err(FAILED.into());
    }
    let answer = flow
        .result
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    answer.unwrap_or_else(|| Ok(json!({"status":"pending"})))
}
pub(super) async fn refresh(marker: String) -> Result<Value, String> {
    let uuid = marker
        .strip_prefix(PREFIX)
        .and_then(normalized_uuid)
        .ok_or(FAILED)?;
    tokio::task::spawn_blocking(move || Backend::find()?.session(&uuid))
        .await
        .map_err(|_| FAILED.to_string())?
}

fn normalized_uuid(text: &str) -> Option<String> {
    let text = text.replace('-', "");
    (text.len() == 32 && text.bytes().all(|c| c.is_ascii_hexdigit()))
        .then(|| text.to_ascii_lowercase())
}
fn device_prompt(line: &str) -> Option<(String, String)> {
    let (url, code) = line
        .strip_prefix("To sign in, open ")?
        .split_once(" in a browser and enter the code ")?;
    let code = code.trim();
    let allowed = [
        "https://www.microsoft.com/",
        "https://microsoft.com/",
        "https://login.microsoftonline.com/",
        "https://login.live.com/",
    ];
    (allowed.iter().any(|p| url.starts_with(p))
        && (4..=20).contains(&code.len())
        && code.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'))
    .then(|| (url.into(), code.into()))
}
fn consume_session(path: &Path, folder: &Path, expected_uuid: &str) -> Result<Value, String> {
    let file = path.canonicalize().map_err(|_| FAILED)?;
    let folder = folder.canonicalize().map_err(|_| FAILED)?;
    if file.parent() != Some(folder.as_path()) {
        return Err(FAILED.into());
    }
    let result = (|| {
        let metadata = std::fs::metadata(&file).map_err(|_| FAILED)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(FAILED.into());
            }
        }
        if metadata.len() > 64 * 1024
            || metadata
                .modified()
                .ok()
                .and_then(|t| SystemTime::now().duration_since(t).ok())
                .is_none_or(|age| age > Duration::from_secs(120))
        {
            return Err(FAILED.into());
        }
        let data: Value = serde_json::from_slice(&std::fs::read(&file).map_err(|_| FAILED)?)
            .map_err(|_| FAILED)?;
        session_answer(&data, expected_uuid)
    })();
    std::fs::remove_file(file).map_err(|_| FAILED)?;
    result
}
fn session_answer(data: &Value, expected_uuid: &str) -> Result<Value, String> {
    let uuid = data["uuid"]
        .as_str()
        .and_then(normalized_uuid)
        .ok_or(FAILED)?;
    let name = data["name"].as_str().ok_or(FAILED)?;
    let token = data["access_token"]
        .as_str()
        .filter(|t| !t.is_empty())
        .ok_or(FAILED)?;
    if uuid != expected_uuid
        || name.is_empty()
        || name.len() > 16
        || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        || data["user_type"].as_str().is_some_and(|v| v != "msa")
    {
        return Err(FAILED.into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| FAILED)?
        .as_secs();
    let expires = token
        .split('.')
        .nth(1)
        .and_then(|p| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(p)
                .ok()
        })
        .and_then(|p| serde_json::from_slice::<Value>(&p).ok())
        .and_then(|p| p["exp"].as_u64())
        .unwrap_or(now + 3600);
    if expires <= now + 60 {
        return Err("horizon_auth_relogin".into());
    }
    Ok(
        json!({"status":"ok","nick":name,"uuid":uuid,"xuid":data["xuid"].as_str().unwrap_or(""),
        "token":token,"refresh_token":format!("{PREFIX}{uuid}"),"expires_in":expires-now-30}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn helper_sign_in_handoff_renewal_and_cancel_use_isolated_folders() {
        let mut random = [0u8; 12];
        OsRng.fill_bytes(&mut random);
        let suffix = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random);
        let directory = std::env::temp_dir().join(format!("turtle-horizon-test-{suffix}"));
        std::fs::create_dir_all(&directory).unwrap();
        let program = directory.join(if cfg!(windows) {
            "fixture.exe"
        } else {
            "fixture"
        });
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/horizon_auth_backend.rs");
        let output = crate::engine::quiet(
            Command::new("rustc")
                .args(["--edition=2021"])
                .arg(source)
                .arg("-o")
                .arg(&program),
        )
        .output()
        .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let backend = Backend {
            program: program.clone(),
            home: directory.join("success"),
        };
        let init = start_with(backend.clone()).await.unwrap();
        assert_eq!(init["provider"], "horizon");
        assert_eq!(init["user_code"], "ABCD1234");
        let handle = init["device_code"].as_str().unwrap();
        assert!(handle.starts_with("horizon:"));
        let deadline = Instant::now() + Duration::from_secs(10);
        let session = loop {
            let reply = poll(handle).unwrap();
            if reply["status"] == "ok" {
                break reply;
            }
            assert!(
                Instant::now() < deadline,
                "the helper must finish its sign-in"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert_eq!(session["nick"], "TestPlayer");
        assert_eq!(session["token"], "test-only-token");
        assert_eq!(
            session["refresh_token"],
            "horizon:11111111111111111111111111111111"
        );
        let sessions = backend.home.join("game/sessions");
        assert_eq!(
            std::fs::read_dir(&sessions).unwrap().count(),
            0,
            "handoff files are consumed"
        );
        let renewed = backend.session(session["uuid"].as_str().unwrap()).unwrap();
        assert_eq!(renewed["uuid"], session["uuid"]);
        assert_eq!(
            std::fs::read_dir(sessions).unwrap().count(),
            0,
            "renewal consumes its new file too"
        );
        ms_device_cancel(handle);

        let cancelled_home = directory.join("cancelled");
        let init = start_with(Backend {
            program,
            home: cancelled_home.clone(),
        })
        .await
        .unwrap();
        let handle = init["device_code"].as_str().unwrap();
        let flow = flows().lock().unwrap().get(handle).cloned().unwrap();
        ms_device_cancel(handle);
        let deadline = Instant::now() + Duration::from_secs(10);
        while flow.result.lock().unwrap().is_none() {
            assert!(Instant::now() < deadline, "cancel must reap the helper");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            !cancelled_home.join("launcher/fixture-signed-in").exists(),
            "cancel stops account creation"
        );
        assert!(poll(handle).is_err());
        assert!(directory
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn only_public_microsoft_device_prompts_are_accepted() {
        assert_eq!(device_prompt("To sign in, open https://www.microsoft.com/link in a browser and enter the code ABCD1234"), Some(("https://www.microsoft.com/link".into(), "ABCD1234".into())));
        assert!(device_prompt("To sign in, open https://microsoft.com.evil.example/link in a browser and enter the code ABCD1234").is_none());
        assert!(device_prompt("access_token=private-token").is_none());
    }
    #[test]
    fn delegated_sessions_are_bound_to_the_selected_account() {
        let uuid = "11111111111111111111111111111111";
        let data = json!({"name":"TestPlayer","uuid":uuid,"access_token":"test-only-token","user_type":"msa"});
        let answer = session_answer(&data, uuid).unwrap();
        assert_eq!(answer["refresh_token"], format!("horizon:{uuid}"));
        assert_eq!(answer["nick"], "TestPlayer");
        assert!(session_answer(&data, "22222222222222222222222222222222").is_err());
        let mut offline = data.clone();
        offline["user_type"] = json!("offline");
        assert!(session_answer(&offline, uuid).is_err());
    }
}
