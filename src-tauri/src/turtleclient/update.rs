//! Signed, first-party native client releases. Never contains Minecraft assets.
use super::{engine, settings, settings_file, BASE};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::io::AsyncWriteExt;

const MAX_ARCHIVE: u64 = 256 * 1024 * 1024;
#[derive(Clone, Default, Serialize)]
pub struct Status {
    pub phase: String,
    pub version: String,
    pub downloaded: u64,
    pub total: u64,
    pub error: String,
}
fn status_cell() -> &'static Mutex<Status> {
    static STATUS: OnceLock<Mutex<Status>> = OnceLock::new();
    STATUS.get_or_init(Default::default)
}
pub fn status() -> Status {
    status_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}
fn set_status(phase: &str, release: Option<&Release>, downloaded: u64, error: &str) {
    *status_cell().lock().unwrap_or_else(|e| e.into_inner()) = Status {
        phase: phase.into(),
        version: release.map(|r| r.version.clone()).unwrap_or_default(),
        downloaded,
        total: release.map(|r| r.size).unwrap_or_default(),
        error: error.into(),
    };
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Release {
    schema: u32,
    kind: String,
    sequence: u64,
    version: String,
    minecraft: String,
    platform: String,
    url: String,
    size: u64,
    sha256: String,
    exe_sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}
#[derive(Serialize, Deserialize)]
struct Installed {
    release: Release,
    directory: String,
}
fn root() -> PathBuf {
    engine::data_dir().join("turtleclient/runtime")
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate(release: &Release) -> Result<(), String> {
    if release.schema != 1
        || release.kind != "turtleclient-native"
        || release.platform != "windows-x86_64"
        || release.minecraft != "26.3"
        || release.sequence == 0
        || release.version.is_empty()
        || release.version.len() > 64
        || !release
            .version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-+".contains(&b))
        || !valid_hash(&release.sha256)
        || !valid_hash(&release.exe_sha256)
        || release.size == 0
        || release.size > MAX_ARCHIVE
        || release.url != format!("{BASE}/client/releases/{}/client.zip", release.sha256)
    {
        return Err("turtle_update_manifest_invalid".into());
    }
    Ok(())
}
fn decode_manifest(bytes: &[u8]) -> Result<Release, String> {
    let result = (|| {
        let envelope: Envelope = serde_json::from_slice(bytes).ok()?;
        let decode = |s: &str| {
            base64::engine::general_purpose::STANDARD
                .decode(s.trim())
                .ok()
        };
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).ok()?;
        let public =
            String::from_utf8(decode(config["plugins"]["updater"]["pubkey"].as_str()?)?).ok()?;
        let signature = String::from_utf8(decode(&envelope.signature)?).ok()?;
        let payload = decode(&envelope.payload)?;
        minisign_verify::PublicKey::decode(public.trim())
            .ok()?
            .verify(
                &payload,
                &minisign_verify::Signature::decode(signature.trim()).ok()?,
                true,
            )
            .ok()?;
        serde_json::from_slice::<Release>(&payload).ok()
    })()
    .ok_or("turtle_update_signature_invalid")?;
    validate(&result)?;
    Ok(result)
}
fn installed_at(root: &Path) -> Option<Installed> {
    let installed: Installed =
        serde_json::from_slice(&std::fs::read(root.join("current.json")).ok()?).ok()?;
    let directory = &installed.directory;
    if directory.is_empty()
        || directory.len() > 110
        || !directory
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return None;
    }
    validate(&installed.release).ok()?;
    Some(installed)
}
fn executable(root: &Path, installed: &Installed) -> PathBuf {
    root.join("versions")
        .join(&installed.directory)
        .join("TurtleClient.exe")
}
fn intact(root: &Path, installed: &Installed) -> bool {
    std::fs::read(executable(root, installed)).is_ok_and(|bytes| {
        bytes.len() as u64 <= MAX_ARCHIVE && hash(&bytes) == installed.release.exe_sha256
    })
}
fn activate(root: &Path, installed: &Installed) -> Result<(), String> {
    let mut config = settings();
    config.executable = executable(root, installed).to_string_lossy().into_owned();
    write_json(&settings_file(), &config)
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let result = (|| -> std::io::Result<()> {
        std::fs::create_dir_all(
            path.parent()
                .ok_or_else(|| std::io::Error::other("parent"))?,
        )?;
        let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(value)?;
        {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        std::fs::rename(temp, path)
    })();
    result.map_err(|_| "turtle_update_install_failed".into())
}
fn allowed_file(name: &str) -> bool {
    matches!(
        name,
        "TurtleClient.exe" | "LICENSE" | "THIRD_PARTY_NOTICES.md" | "turtleclient-base.json"
    ) || (name.starts_with("licenses/") && name.ends_with(".txt"))
}
fn unpack(archive: &Path, stage: &Path, release: &Release) -> Result<(), String> {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        if zip.len() > 256 {
            return Err("entries".into());
        }
        let mut total = 0u64;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index)?;
            if entry.is_dir() {
                continue;
            }
            let relative = entry.enclosed_name().ok_or("path")?;
            let name = relative.to_str().ok_or("path")?.replace('\\', "/");
            if !allowed_file(&name)
                || entry.name().contains('\\')
                || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            {
                return Err("file".into());
            }
            total = total.checked_add(entry.size()).ok_or("size")?;
            if total > 512 * 1024 * 1024 {
                return Err("size".into());
            }
            let target = stage.join(relative);
            std::fs::create_dir_all(target.parent().ok_or("parent")?)?;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)?;
            let copied = std::io::copy(
                &mut Read::by_ref(&mut entry).take(512 * 1024 * 1024 + 1),
                &mut file,
            )?;
            if copied != entry.size() {
                return Err("size".into());
            }
            file.sync_all()?;
        }
        let exe = std::fs::read(stage.join("TurtleClient.exe"))?;
        if !exe.starts_with(b"MZ") || hash(&exe) != release.exe_sha256 {
            return Err("hash".into());
        }
        for notice in [
            "LICENSE",
            "THIRD_PARTY_NOTICES.md",
            "turtleclient-base.json",
        ] {
            if !stage.join(notice).is_file() {
                return Err("notice".into());
            }
        }
        Ok(())
    })();
    result.map_err(|_| "turtle_update_archive_invalid".into())
}
async fn bounded(response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    let mut response = response
        .error_for_status()
        .map_err(|_| "turtle_update_unavailable")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_update_unavailable")?
    {
        if bytes.len() + chunk.len() > max {
            return Err("turtle_update_manifest_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn gate() -> &'static tokio::sync::Mutex<Option<Instant>> {
    static GATE: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    GATE.get_or_init(Default::default)
}
async fn install(force: bool) -> Result<(), String> {
    if std::env::var("TURTLE_CLIENT_NO_UPDATE").as_deref() == Ok("1") {
        return Ok(());
    }
    if !cfg!(target_os = "windows") {
        return Err("turtle_update_platform_unsupported".into());
    }
    let mut checked = gate().lock().await;
    let root = root();
    if !force && checked.is_some_and(|at| at.elapsed() < Duration::from_secs(300)) {
        if let Some(current) = installed_at(&root).filter(|i| intact(&root, i)) {
            return activate(&root, &current);
        }
    }
    set_status("checking", None, 0, "");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "turtle_update_unavailable")?;
    let response = client
        .get(format!("{BASE}/client/latest.json"))
        .timeout(Duration::from_secs(20))
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|_| "turtle_update_unavailable")?;
    let release = decode_manifest(&bounded(response, 128 * 1024).await?)?;
    if let Some(current) = installed_at(&root) {
        if release.sequence < current.release.sequence
            || (release.sequence == current.release.sequence
                && release.sha256 != current.release.sha256)
        {
            return Err("turtle_update_rollback_rejected".into());
        }
        if release.sha256 == current.release.sha256 && intact(&root, &current) {
            activate(&root, &current)?;
            *checked = Some(Instant::now());
            set_status("ready", Some(&release), release.size, "");
            return Ok(());
        }
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    let stage = root.join("staging").join(&nonce);
    tokio::fs::create_dir_all(&stage)
        .await
        .map_err(|_| "turtle_update_install_failed")?;
    let archive = stage.join("client.zip.part");
    let mut response = client
        .get(&release.url)
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|_| "turtle_update_unavailable")?
        .error_for_status()
        .map_err(|_| "turtle_update_unavailable")?;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&archive)
        .await
        .map_err(|_| "turtle_update_install_failed")?;
    let mut digest = Sha256::new();
    let mut size = 0u64;
    set_status("downloading", Some(&release), 0, "");
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_update_unavailable")?
    {
        size += chunk.len() as u64;
        if size > release.size {
            return Err("turtle_update_hash_invalid".into());
        }
        digest.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|_| "turtle_update_install_failed")?;
        set_status("downloading", Some(&release), size, "");
    }
    file.sync_all()
        .await
        .map_err(|_| "turtle_update_install_failed")?;
    drop(file);
    if size != release.size || format!("{:x}", digest.finalize()) != release.sha256 {
        return Err("turtle_update_hash_invalid".into());
    }
    set_status("installing", Some(&release), size, "");
    let install_release = release.clone();
    let installed = tokio::task::spawn_blocking(move || {
        let payload = stage.join("payload");
        unpack(&archive, &payload, &install_release)?;
        let directory = format!("{}-{nonce}", install_release.sha256);
        std::fs::create_dir_all(root.join("versions"))
            .map_err(|_| "turtle_update_install_failed")?;
        std::fs::rename(payload, root.join("versions").join(&directory))
            .map_err(|_| "turtle_update_install_failed")?;
        let installed = Installed {
            release: install_release,
            directory,
        };
        write_json(&root.join("current.json"), &installed)?;
        activate(&root, &installed)?;
        let _ = std::fs::remove_file(archive);
        let _ = std::fs::remove_dir(stage);
        Ok::<_, String>(installed)
    })
    .await
    .map_err(|_| "turtle_update_install_failed")??;
    *checked = Some(Instant::now());
    set_status("ready", Some(&installed.release), size, "");
    Ok(())
}
pub async fn check(force: bool) -> Result<(), String> {
    match install(force).await {
        Ok(()) => Ok(()),
        Err(error) => {
            set_status("error", None, 0, &error);
            Err(error)
        }
    }
}
pub async fn before_launch() -> Result<(), String> {
    if let Err(error) = check(false).await {
        let root = root();
        if let Some(installed) = installed_at(&root).filter(|i| intact(&root, i)) {
            return activate(&root, &installed);
        }
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
pub async fn turtle_client_update() -> Result<Status, String> {
    check(true).await?;
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release() -> Release {
        Release {
            schema: 1,
            kind: "turtleclient-native".into(),
            sequence: 1,
            version: "0.10.1-dev".into(),
            minecraft: "26.3".into(),
            platform: "windows-x86_64".into(),
            url: format!("{BASE}/client/releases/{}/client.zip", "a".repeat(64)),
            size: 10,
            sha256: "a".repeat(64),
            exe_sha256: "b".repeat(64),
        }
    }
    #[test]
    fn release_cannot_select_another_host_or_platform() {
        let mut r = release();
        assert!(validate(&r).is_ok());
        r.url = "https://example.com/client.zip".into();
        assert!(validate(&r).is_err());
        r = release();
        r.platform = "linux".into();
        assert!(validate(&r).is_err());
    }
    #[test]
    fn unsigned_payload_cannot_install() {
        assert!(decode_manifest(br#"{"payload":"e30=","signature":""}"#).is_err())
    }
    #[test]
    fn archive_cannot_escape_or_ship_game_assets() {
        assert!(allowed_file("licenses/horizon.txt"));
        assert!(!allowed_file("assets/minecraft/stone.png"));
        assert!(!allowed_file("game.jar"));
        assert!(!allowed_file("other.exe"));
    }
}
