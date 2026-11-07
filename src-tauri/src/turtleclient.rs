//! TurtleClient's native runtime and its own services; independent of Millida APIs.
use crate::engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const BASE: &str = "https://45.133.9.162/turtleclient";
pub(crate) mod update;
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    executable: String,
    resources: String,
    game_dir: String,
}
fn settings_file() -> PathBuf {
    engine::data_dir().join("turtleclient.json")
}
fn existing(path: PathBuf) -> Option<String> {
    path.exists().then(|| path.to_string_lossy().into_owned())
}
fn defaults() -> Settings {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    let executable = std::env::var("TURTLE_CLIENT")
        .ok()
        .or_else(|| {
            roots.iter().find_map(|root| {
                [
                    root.join("TurtleClient.exe"),
                    root.join("TurtleClient/TurtleClient.exe"),
                    root.join("TurtleClient-Mod/target/fast/horizon-client.exe"),
                    root.join("../TurtleClient-Mod/target/fast/horizon-client.exe"),
                ]
                .into_iter()
                .find_map(existing)
            })
        })
        .unwrap_or_default();
    let resources = std::env::var("TURTLE_RESOURCES")
        .ok()
        .or_else(|| {
            let versions = dirs::config_dir()?.join("horizon-launcher/versions");
            let mut entries = std::fs::read_dir(versions)
                .ok()?
                .filter_map(Result::ok)
                .map(|e| e.path())
                .collect::<Vec<_>>();
            entries.sort();
            entries.reverse();
            entries
                .into_iter()
                .find_map(|p| existing(p.join(".local/horizon-client/26.3")))
        })
        .unwrap_or_default();
    Settings {
        executable,
        resources,
        game_dir: engine::data_dir()
            .join("turtleclient/game")
            .to_string_lossy()
            .into_owned(),
    }
}
fn settings() -> Settings {
    std::fs::read(settings_file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(defaults)
}
#[tauri::command]
pub async fn turtle_pick_path(field: String) -> Result<Option<String>, String> {
    let path = match field.as_str() {
        "executable" => engine::pick_file(engine::dialog()).await,
        "resources" | "game_dir" => engine::pick_folder(engine::dialog()).await,
        _ => return Err("turtle_action_invalid".into()),
    };
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}
fn runtime() -> &'static Mutex<Option<Child>> {
    static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    CHILD.get_or_init(|| Mutex::new(None))
}
fn running() -> bool {
    let mut slot = runtime().lock().unwrap_or_else(|e| e.into_inner());
    match slot.as_mut().map(Child::try_wait) {
        Some(Ok(None)) => true,
        _ => {
            *slot = None;
            false
        }
    }
}
#[tauri::command]
pub async fn turtle_status() -> Result<Value, String> {
    crate::commands::blocking(|| json!({"settings":settings(),"running":running(),"update":update::status()})).await
}
#[tauri::command]
pub async fn turtle_configure(settings: Settings) -> Result<(), String> {
    crate::commands::blocking(move || {
        validate(&settings)?;
        std::fs::create_dir_all(engine::data_dir()).map_err(|_| "turtle_settings_failed")?;
        std::fs::write(
            settings_file(),
            serde_json::to_vec(&settings).map_err(|_| "turtle_settings_failed")?,
        )
        .map_err(|_| "turtle_settings_failed".to_string())
    })
    .await?
}
fn validate(settings: &Settings) -> Result<(), String> {
    let exe = Path::new(&settings.executable);
    if !exe.is_absolute() || !exe.is_file() {
        return Err("turtle_executable_missing".into());
    }
    if !matches!(
        exe.file_name().and_then(|s| s.to_str()),
        Some("TurtleClient.exe" | "turtle-client.exe" | "horizon-client.exe" | "TurtleClient" | "horizon-client")
    ) {
        return Err("turtle_executable_invalid".into());
    }
    if !Path::new(&settings.resources).is_absolute() || !Path::new(&settings.resources).is_dir() {
        return Err("turtle_resources_missing".into());
    }
    if !Path::new(&settings.game_dir).is_absolute() {
        return Err("turtle_game_dir_invalid".into());
    }
    Ok(())
}
async fn profile(account: &str) -> Result<(Value, String), String> {
    if engine::ms_session_refresh(account).await?["status"] != "ok" {
        return Err("turtle_login_required".into());
    }
    let token = engine::mc_token(account).ok_or("turtle_login_required")?;
    let response = engine::client()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&token)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "turtle_profile_unavailable")?;
    if !response.status().is_success() {
        return Err("turtle_login_required".into());
    }
    let profile: Value = response
        .json()
        .await
        .map_err(|_| "turtle_profile_unavailable")?;
    let uuid = profile["id"].as_str().unwrap_or_default();
    let name = profile["name"].as_str().unwrap_or_default();
    if uuid.len() != 32
        || !uuid.bytes().all(|b| b.is_ascii_hexdigit())
        || name.is_empty()
        || name.len() > 16
    {
        return Err("turtle_profile_unavailable".into());
    }
    Ok((profile, token))
}
#[tauri::command]
pub async fn turtle_launch(account_id: Option<String>, nick: String) -> Result<(), String> {
    update::before_launch().await?;
    let config = settings();
    validate(&config)?;
    let id = account_id.ok_or("turtle_login_required")?;
    let (p, t) = profile(&id).await?;
    let identity = Some(json!({"name":p["name"],"uuid":p["id"],"access_token":t,"user_type":"msa"}));
    if nick.is_empty()
        || nick.len() > 16
        || !nick.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("turtle_nickname_invalid".into());
    }
    crate::commands::blocking(move || spawn(&config, &nick, identity)).await?
}
fn spawn(config: &Settings, nick: &str, identity: Option<Value>) -> Result<(), String> {
    use std::io::Write;
    let mut slot = runtime().lock().unwrap_or_else(|e| e.into_inner());
    if slot
        .as_mut()
        .is_some_and(|c| matches!(c.try_wait(), Ok(None)))
    {
        return Err("turtle_already_running".into());
    }
    let game = PathBuf::from(&config.game_dir);
    std::fs::create_dir_all(&game).map_err(|_| "turtle_game_dir_invalid")?;
    let home = game.join(".turtleclient");
    std::fs::create_dir_all(&home).map_err(|_| "turtle_game_dir_invalid")?;
    let mut command = Command::new(&config.executable);
    command.current_dir(&game).args([
        "--resources",
        &config.resources,
        "--game-dir",
        &config.game_dir,
    ]);
    if identity.is_some() {
        command.arg("--session-stdin").stdin(Stdio::piped());
    } else {
        command.args(["--name", nick]).stdin(Stdio::null());
    }
    command.env("HORIZON_HOME", &home);
    // Never put credentials in the process command line or launcher logs.
    let log =
        std::fs::File::create(home.join("launcher-game.log")).map_err(|_| "turtle_log_failed")?;
    command
        .stdout(log.try_clone().map_err(|_| "turtle_log_failed")?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "turtle_start_failed")?;
    if let Some(identity) = identity {
        let bytes = serde_json::to_vec(&identity).map_err(|_| "turtle_session_failed")?;
        if !child
            .stdin
            .take()
            .is_some_and(|mut pipe| pipe.write_all(&bytes).is_ok())
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err("turtle_session_failed".into());
        }
    }
    *slot = Some(child);
    Ok(())
}
async fn request(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Result<Value, String> {
    let mut req = engine::client()
        .request(method, format!("{BASE}{path}"))
        .timeout(Duration::from_secs(20));
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = req.send().await.map_err(|_| "turtle_service_unavailable")?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("turtle_http_{}", status.as_u16()));
    }
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    if response
        .content_length()
        .is_some_and(|n| n > 2 * 1024 * 1024)
    {
        return Err("turtle_response_invalid".into());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_service_unavailable")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("turtle_response_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "turtle_response_invalid".into())
}
#[tauri::command]
pub async fn turtle_catalog() -> Result<Value, String> {
    let (models, capes) = tokio::try_join!(
        request(reqwest::Method::GET, "/api/cosmetics/catalog", None, None),
        request(reqwest::Method::GET, "/api/cosmetics/capes", None, None)
    )?;
    let categories = request(
        reqwest::Method::GET,
        "/social/wardrobe/categories",
        None,
        None,
    )
    .await?;
    Ok(json!({"models":models["items"],"capes":capes["items"],"free":true,"categories":categories}))
}
#[tauri::command]
pub async fn turtle_wardrobe(
    account_id: String,
    slot: Option<String>,
    item: Option<String>,
) -> Result<Value, String> {
    turtle_friends_connect(account_id.clone()).await?;
    let token = {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&account_id)
            .map(|s| s.token.clone())
            .ok_or("turtle_friends_connect_required")?
    };
    let result = if let Some(slot) = slot {
        request(
            reqwest::Method::POST,
            "/social/wardrobe",
            Some(json!({"slot":slot,"item":item})),
            Some(&token),
        )
        .await
    } else {
        request(reqwest::Method::GET, "/social/wardrobe", None, Some(&token)).await
    };
    if result
        .as_ref()
        .err()
        .is_some_and(|e| e == "turtle_http_401")
    {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&account_id);
    }
    result
}
#[tauri::command]
pub async fn turtle_model(id: String, hash: String) -> Result<Value, String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        || hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("turtle_response_invalid".into());
    }
    request(
        reqwest::Method::GET,
        &format!("/api/cosmetics/item/{id}?hash={hash}"),
        None,
        None,
    )
    .await
}
#[tauri::command]
pub async fn turtle_cape(uuid: String) -> Result<Option<String>, String> {
    use base64::Engine as _;
    let hex = uuid.replace('-', "");
    if hex.len() != 32 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("turtle_response_invalid".into());
    }
    let canonical = format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    let mut response = engine::client()
        .get(format!("{BASE}/api/cape/{canonical}"))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "turtle_service_unavailable")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err("turtle_service_unavailable".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_service_unavailable")?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("turtle_response_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else {
        return Err("turtle_response_invalid".into());
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    )))
}
struct FriendSession {
    token: String,
    expires: Instant,
}
fn sessions() -> &'static Mutex<HashMap<String, FriendSession>> {
    static S: OnceLock<Mutex<HashMap<String, FriendSession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
#[tauri::command]
pub async fn turtle_friends_connect(account_id: String) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    if sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&account_id)
        .is_some_and(|s| s.expires > Instant::now())
    {
        return Ok(json!({"connected":true}));
    }
    let (_, minecraft_token) = profile(&account_id).await?;
    let answer = request(
        reqwest::Method::POST,
        "/social/session",
        None,
        Some(&minecraft_token),
    )
    .await?;
    let token = answer["session"]
        .as_str()
        .filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("turtle_response_invalid")?
        .to_string();
    sessions().lock().unwrap_or_else(|e| e.into_inner()).insert(
        account_id,
        FriendSession {
            token,
            expires: Instant::now() + Duration::from_secs(3500),
        },
    );
    Ok(json!({"connected":true}))
}
#[tauri::command]
pub async fn turtle_friends(
    account_id: String,
    action: String,
    name: Option<String>,
    uuid: Option<String>,
) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    let token = {
        let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, s| s.expires > Instant::now());
        sessions
            .get(&account_id)
            .map(|s| s.token.clone())
            .ok_or("turtle_friends_connect_required")?
    };
    let uuid = uuid.unwrap_or_default();
    if matches!(action.as_str(), "accept" | "reject" | "remove")
        && (uuid.len() != 36 || !uuid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
    {
        return Err("turtle_response_invalid".into());
    }
    let result = match action.as_str() {
        "list" => request(reqwest::Method::GET, "/social/friends", None, Some(&token)).await,
        "request" => {
            request(
                reqwest::Method::POST,
                "/social/friends/request",
                Some(json!({"name":name.unwrap_or_default()})),
                Some(&token),
            )
            .await
        }
        "accept" | "reject" => {
            request(
                reqwest::Method::POST,
                "/social/friends/decision",
                Some(json!({"uuid":uuid,"accept":action=="accept"})),
                Some(&token),
            )
            .await
        }
        "remove" => {
            request(
                reqwest::Method::DELETE,
                &format!("/social/friends/{uuid}"),
                None,
                Some(&token),
            )
            .await
        }
        _ => Err("turtle_action_invalid".into()),
    };
    if result
        .as_ref()
        .err()
        .is_some_and(|e| e == "turtle_http_401")
    {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&account_id);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_process_receives_session_privately_and_refuses_duplicate_launch() {
        use aes_gcm::aead::{rand_core::RngCore, OsRng};
        let mut bytes = [0u8; 12];
        OsRng.fill_bytes(&mut bytes);
        let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let home = std::env::temp_dir().join(format!("turtle-native-{suffix}"));
        std::fs::create_dir_all(home.join("resources")).unwrap();
        let exe = home.join(if cfg!(windows) {
            "TurtleClient.exe"
        } else {
            "TurtleClient"
        });
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/turtle_native.rs");
        assert!(Command::new("rustc")
            .arg(source)
            .arg("-o")
            .arg(&exe)
            .status()
            .unwrap()
            .success());
        let config = Settings {
            executable: exe.to_string_lossy().into_owned(),
            resources: home.join("resources").to_string_lossy().into_owned(),
            game_dir: home.join("game").to_string_lossy().into_owned(),
        };
        validate(&config).unwrap();
        let session = json!({"name":"FixturePlayer","uuid":"00000000000000000000000000000001","access_token":"fixture-private-token","user_type":"msa"});
        spawn(&config, "FixturePlayer", Some(session)).unwrap();
        let marker = home.join("game/.turtleclient/fixture-ready");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let received = marker.exists();
        let duplicate = spawn(&config, "FixturePlayer", None);
        // Always reap our fixture, even when an assertion will report a failure.
        {
            let mut slot = runtime().lock().unwrap();
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *slot = None;
        }
        std::fs::remove_dir_all(home).unwrap();
        assert!(
            received,
            "the native executable never received the account session"
        );
        assert_eq!(duplicate, Err("turtle_already_running".into()));
    }
}
