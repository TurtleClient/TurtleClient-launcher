//! Authenticated launcher wardrobe over Ocean's existing item storage/API.
use super::{authenticated, lock, Shared};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use uuid::Uuid;

#[derive(Clone)]
struct Wardrobe {
    auth: Shared,
    root: PathBuf,
    categories: PathBuf,
    ocean: String,
    client: reqwest::Client,
}
fn player(state: &Wardrobe, headers: &HeaderMap) -> Result<(Uuid, String), StatusCode> {
    let mut auth = lock(&state.auth)?;
    let id = authenticated(&mut auth, headers)?;
    let name = auth
        .database
        .users
        .get(&id)
        .ok_or(StatusCode::UNAUTHORIZED)?
        .name
        .clone();
    Ok((id, name))
}
fn read(path: &std::path::Path, max: u64) -> Result<Option<Value>, StatusCode> {
    use std::io::Read;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if bytes.len() as u64 > max {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
fn category_config(state: &Wardrobe) -> Result<Value, StatusCode> {
    let value = read(&state.categories, 65536)?.unwrap_or_else(|| {
        serde_json::from_str(include_str!("../wardrobe-categories.example.json"))
            .expect("bundled categories")
    });
    let categories = value["categories"]
        .as_array()
        .filter(|c| !c.is_empty() && c.len() <= 32)
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let valid_id = |id: &str| {
        !id.is_empty()
            && id.len() <= 32
            && id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    };
    for category in categories {
        if !category["id"].as_str().is_some_and(valid_id) || !category["label"].is_object() {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        if category["label"].as_object().is_some_and(|labels| {
            labels.is_empty()
                || labels.len() > 32
                || labels
                    .values()
                    .any(|v| !v.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 160))
        }) {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        if !category["slots"].as_array().is_some_and(|slots| {
            slots.len() <= 6
                && slots.iter().all(|slot| {
                    matches!(
                        slot.as_str(),
                        Some("head" | "back" | "torso" | "shoulder" | "name_tag" | "cape")
                    )
                })
        }) {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    let unique = categories
        .iter()
        .filter_map(|c| c["id"].as_str())
        .collect::<std::collections::HashSet<_>>();
    if unique.len() != categories.len() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    if let Some(assignments) = value["assignments"].as_object() {
        if assignments.len() > 1024
            || assignments
                .values()
                .any(|id| !categories.iter().any(|c| c["id"] == *id))
        {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    if let Some(items) = value.get("items") {
        let items = items
            .as_object()
            .filter(|items| items.len() <= 1024)
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
        for (id, item) in items {
            if !item_id(id)
                || !item.as_object().is_some_and(|item| {
                    item.keys().all(|key| {
                        matches!(key.as_str(), "type" | "access" | "price_minor" | "currency")
                    })
                })
            {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            if item
                .get("access")
                .is_some_and(|v| !matches!(v.as_str(), Some("free" | "paid")))
            {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            if item.get("type").is_some_and(|v| {
                !v.as_str().is_some_and(|s| {
                    !s.is_empty()
                        && s.len() <= 32
                        && s.bytes()
                            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
                })
            }) {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            if item
                .get("price_minor")
                .is_some_and(|v| !v.as_u64().is_some_and(|n| n <= 1_000_000_000_000))
            {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            if item.get("currency").is_some_and(|v| {
                !v.as_str()
                    .is_some_and(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_uppercase()))
            }) {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
    Ok(value)
}
fn owned(state: &Wardrobe, id: Uuid) -> Result<Vec<String>, StatusCode> {
    let ledger = read(
        &state
            .categories
            .with_file_name("wardrobe-entitlements.json"),
        8 * 1024 * 1024,
    )?
    .unwrap_or_else(|| json!({}));
    Ok(ledger["players"][id.to_string()]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|id| id.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}
fn may_wear(state: &Wardrobe, player: Uuid, id: &str) -> Result<(), StatusCode> {
    if category_config(state)?["items"][id]["access"] == "paid"
        && !owned(state, player)?.iter().any(|owned| owned == id)
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
fn cape_hash(root: &std::path::Path, cape: &Value) -> Result<Option<String>, StatusCode> {
    use std::{
        collections::HashMap,
        io::Read,
        sync::{Mutex, OnceLock},
        time::SystemTime,
    };
    type Cache = HashMap<(PathBuf, u64, SystemTime), String>;
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let Some(name) = cape["image_path"].as_str() else {
        return Ok(None);
    };
    if std::path::Path::new(name).components().count() != 1 || name.contains(['/', '\\']) {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let path = root.join("capes").join(name);
    let file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let meta = file
        .metadata()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let key = (
        path,
        meta.len(),
        meta.modified()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    );
    let mut cache = CACHE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if let Some(hash) = cache.get(&key) {
        return Ok(Some(hash.clone()));
    }
    let mut bytes = Vec::new();
    file.take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if cache.len() >= 1024 {
        cache.clear();
    }
    cache.insert(key, hash.clone());
    Ok(Some(hash))
}
async fn snapshot(
    State(state): State<Wardrobe>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let (id, name) = player(&state, &headers)?;
    tokio::task::spawn_blocking(move|| {
        let wardrobe=read(&state.root.join("data/turtle-cosmetics/wardrobe.json"),8*1024*1024)?.unwrap_or_else(||json!({}));
        let equipped=wardrobe["equipped"][id.to_string()].as_object().cloned().unwrap_or_default();
        let cape=read(&state.root.join(format!("data/{id}.json")),65536)?;
        let hash=cape.as_ref().map(|cape|cape_hash(&state.root,cape)).transpose()?.flatten();
        Ok(Json(json!({"player":{"uuid":id,"name":name},"equipped":equipped,"cape":hash.is_some(),"cape_revision":hash,"categories":category_config(&state)?,"owned":owned(&state,id)?})))
    }).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Equip {
    slot: String,
    item: Option<String>,
}
fn item_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
async fn upstream(
    response: Result<reqwest::Response, reqwest::Error>,
) -> Result<reqwest::Response, StatusCode> {
    let response = response.map_err(|_| StatusCode::BAD_GATEWAY)?;
    if !response.status().is_success() {
        return Err(
            StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
        );
    }
    Ok(response)
}
async fn equip(
    State(state): State<Wardrobe>,
    headers: HeaderMap,
    Json(body): Json<Equip>,
) -> Result<StatusCode, StatusCode> {
    let (id, _) = player(&state, &headers)?;
    if let Some(item) = &body.item {
        may_wear(&state, id, item)?;
    }
    if !matches!(
        body.slot.as_str(),
        "head" | "back" | "torso" | "shoulder" | "name_tag" | "cape"
    ) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if body.slot == "cape" {
        if let Some(hash) = body.item {
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(StatusCode::BAD_REQUEST);
            }
            let catalog: Value = upstream(
                state
                    .client
                    .get(format!("{}/api/cosmetics/capes", state.ocean))
                    .send()
                    .await,
            )
            .await?
            .json()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
            let owner = catalog["items"]
                .as_array()
                .and_then(|rows| rows.iter().find(|r| r["hash"] == hash))
                .and_then(|row| row["owner"].as_str())
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or(StatusCode::NOT_FOUND)?;
            let mut response = upstream(
                state
                    .client
                    .get(format!("{}/api/cape/{owner}", state.ocean))
                    .send()
                    .await,
            )
            .await?;
            let mime = response
                .headers()
                .get("content-type")
                .and_then(|s| s.to_str().ok())
                .unwrap_or("image/png")
                .to_string();
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| StatusCode::BAD_GATEWAY)?
            {
                if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                    return Err(StatusCode::PAYLOAD_TOO_LARGE);
                }
                bytes.extend_from_slice(&chunk);
            }
            if format!("{:x}", Sha256::digest(&bytes)) != hash {
                return Err(StatusCode::CONFLICT);
            }
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(if mime == "image/gif" {
                    "cape.gif"
                } else {
                    "cape.png"
                })
                .mime_str(&mime)
                .map_err(|_| StatusCode::BAD_GATEWAY)?;
            upstream(
                state
                    .client
                    .post(format!("{}/api/cape/{id}", state.ocean))
                    .multipart(reqwest::multipart::Form::new().part("file", part))
                    .send()
                    .await,
            )
            .await?;
        } else {
            let response = state
                .client
                .delete(format!("{}/api/cape/{id}", state.ocean))
                .send()
                .await
                .map_err(|_| StatusCode::BAD_GATEWAY)?;
            if response.status() != reqwest::StatusCode::NOT_FOUND {
                upstream(Ok(response)).await?;
            }
        }
    } else {
        if body.item.as_deref().is_some_and(|id| !item_id(id)) {
            return Err(StatusCode::BAD_REQUEST);
        }
        upstream(
            state
                .client
                .post(format!("{}/api/cosmetics/equip/{id}", state.ocean))
                .json(&json!({"slot":body.slot,"item":body.item}))
                .send()
                .await,
        )
        .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}
fn routes(state: Wardrobe) -> Router {
    Router::new()
        .route("/wardrobe", get(snapshot).post(equip))
        .route(
            "/wardrobe/categories",
            get(|State(state): State<Wardrobe>| async move { category_config(&state).map(Json) }),
        )
        .layer(axum::extract::DefaultBodyLimit::max(1024))
        .with_state(state)
}
pub fn router(auth: Shared) -> Router {
    routes(Wardrobe {
        auth,
        root: PathBuf::from(
            std::env::var("TURTLE_WARDROBE_ROOT")
                .unwrap_or_else(|_| "/var/lib/turtleclient/ocean".into()),
        ),
        categories: PathBuf::from("wardrobe-categories.json"),
        ocean: "http://127.0.0.1:3000".into(),
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("HTTP client"),
    })
}
#[cfg(test)]
pub(super) fn test_router(
    auth: Shared,
    root: PathBuf,
    categories: PathBuf,
    ocean: String,
) -> Router {
    routes(Wardrobe {
        auth,
        root,
        categories,
        ocean,
        client: reqwest::Client::new(),
    })
}
