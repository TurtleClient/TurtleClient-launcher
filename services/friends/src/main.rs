//! Independent TurtleClient friends service. Minecraft tokens are verified once,
//! never persisted, logged or returned. Only short-lived service sessions survive in memory.
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

type Failure = StatusCode;
#[derive(Clone, Default, Serialize, Deserialize)]
struct User {
    name: String,
    friends: BTreeSet<Uuid>,
    incoming: BTreeSet<Uuid>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Database {
    users: BTreeMap<Uuid, User>,
}
struct Session {
    player: Uuid,
    expires: Instant,
}
struct Service {
    database: Database,
    sessions: HashMap<String, Session>,
    seen: HashMap<Uuid, Instant>,
    file: PathBuf,
}
type Shared = Arc<Mutex<Service>>;
fn lock(state: &Shared) -> Result<std::sync::MutexGuard<'_, Service>, Failure> {
    state.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
fn authenticated(state: &mut Service, headers: &HeaderMap) -> Result<Uuid, Failure> {
    let token = headers
        .get("authorization")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let now = Instant::now();
    state.sessions.retain(|_, s| s.expires > now);
    let player = state
        .sessions
        .get(token)
        .ok_or(StatusCode::UNAUTHORIZED)?
        .player;
    state.seen.insert(player, now);
    Ok(player)
}
impl Service {
    fn commit(&mut self, next: Database) -> Result<(), Failure> {
        let bytes = serde_json::to_vec(&next).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tmp = self.file.with_extension("tmp");
        std::fs::write(&tmp, bytes)
            .and_then(|_| std::fs::rename(tmp, &self.file))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        self.database = next;
        Ok(())
    }
}
#[derive(Deserialize)]
struct Profile {
    id: Uuid,
    name: String,
}
fn valid_name(name: &str) -> bool {
    (1..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

async fn login(
    State(state): State<Shared>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, Failure> {
    let token = headers
        .get("authorization")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .filter(|s| s.len() <= 8192)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    // A UUID supplied by the caller never establishes identity.
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    if !response.status().is_success() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let profile: Profile = response.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    if profile.id.is_nil() || !valid_name(&profile.name) {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let mut service = lock(&state)?;
    service.sessions.retain(|_, s| s.expires > Instant::now());
    if service.sessions.len() >= 4096
        || (service.database.users.len() >= 10000
            && !service.database.users.contains_key(&profile.id))
    {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    let mut next = service.database.clone();
    next.users.entry(profile.id).or_default().name = profile.name;
    service.commit(next)?;
    let session = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    service.sessions.insert(
        session.clone(),
        Session {
            player: profile.id,
            expires: Instant::now() + Duration::from_secs(3600),
        },
    );
    service.seen.insert(profile.id, Instant::now());
    Ok(Json(
        serde_json::json!({"session":session,"expires_in":3600}),
    ))
}

async fn list(
    State(state): State<Shared>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, Failure> {
    let mut service = lock(&state)?;
    let me = authenticated(&mut service, &headers)?;
    let user = service
        .database
        .users
        .get(&me)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let row = |id: &Uuid| serde_json::json!({"uuid":id,"name":service.database.users.get(id).map(|u|u.name.as_str()).unwrap_or(""),"online":service.seen.get(id).is_some_and(|at|at.elapsed()<Duration::from_secs(75))});
    let outgoing: Vec<_> = service
        .database
        .users
        .iter()
        .filter(|(_, u)| u.incoming.contains(&me))
        .map(|(id, _)| row(id))
        .collect();
    Ok(Json(
        serde_json::json!({"friends":user.friends.iter().map(row).collect::<Vec<_>>(),"incoming":user.incoming.iter().map(row).collect::<Vec<_>>(),"outgoing":outgoing}),
    ))
}
#[derive(Deserialize)]
struct Request {
    name: String,
}
fn request(database: &mut Database, me: Uuid, name: &str) -> Result<(), Failure> {
    if !valid_name(name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let target = database
        .users
        .iter()
        .find(|(_, u)| u.name.eq_ignore_ascii_case(name))
        .map(|(id, _)| *id)
        .ok_or(StatusCode::NOT_FOUND)?;
    if me == target {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mine = database.users.get(&me).ok_or(StatusCode::UNAUTHORIZED)?;
    if mine.friends.len() >= 200 {
        return Err(StatusCode::CONFLICT);
    }
    if mine.friends.contains(&target) {
        return Ok(());
    }
    let outgoing = database
        .users
        .values()
        .filter(|u| u.incoming.contains(&me))
        .count();
    if outgoing >= 50 {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let theirs = database
        .users
        .get_mut(&target)
        .ok_or(StatusCode::NOT_FOUND)?;
    if theirs.incoming.len() >= 200 {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    theirs.incoming.insert(me);
    Ok(())
}
async fn send_request(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Request>,
) -> Result<StatusCode, Failure> {
    let mut service = lock(&state)?;
    let me = authenticated(&mut service, &headers)?;
    let mut next = service.database.clone();
    request(&mut next, me, body.name.trim())?;
    service.commit(next)?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct Decision {
    uuid: Uuid,
    accept: bool,
}
fn decide(database: &mut Database, me: Uuid, other: Uuid, accept: bool) -> Result<(), Failure> {
    let mine = database.users.get(&me).ok_or(StatusCode::UNAUTHORIZED)?;
    if !mine.incoming.contains(&other) {
        return Err(StatusCode::NOT_FOUND);
    }
    if accept
        && (mine.friends.len() >= 200
            || database
                .users
                .get(&other)
                .is_none_or(|u| u.friends.len() >= 200))
    {
        return Err(StatusCode::CONFLICT);
    }
    let mine = database
        .users
        .get_mut(&me)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    mine.incoming.remove(&other);
    if accept {
        mine.friends.insert(other);
    }
    if let Some(theirs) = database.users.get_mut(&other) {
        theirs.incoming.remove(&me);
        if accept {
            theirs.friends.insert(me);
        }
    }
    Ok(())
}
async fn decision(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Decision>,
) -> Result<StatusCode, Failure> {
    let mut service = lock(&state)?;
    let me = authenticated(&mut service, &headers)?;
    let mut next = service.database.clone();
    decide(&mut next, me, body.uuid, body.accept)?;
    service.commit(next)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn remove(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(other): Path<Uuid>,
) -> Result<StatusCode, Failure> {
    let mut service = lock(&state)?;
    let me = authenticated(&mut service, &headers)?;
    let mut next = service.database.clone();
    if let Some(mine) = next.users.get_mut(&me) {
        mine.friends.remove(&other);
        mine.incoming.remove(&other);
    }
    if let Some(theirs) = next.users.get_mut(&other) {
        theirs.friends.remove(&me);
        theirs.incoming.remove(&me);
    }
    service.commit(next)?;
    Ok(StatusCode::NO_CONTENT)
}
fn router(state: Shared) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/session", post(login))
        .route("/friends", get(list))
        .route("/friends/request", post(send_request))
        .route("/friends/decision", post(decision))
        .route("/friends/:uuid", axum::routing::delete(remove))
        .layer(DefaultBodyLimit::max(1024))
        .with_state(state)
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let file = PathBuf::from(
        std::env::var("TURTLE_FRIENDS_FILE").unwrap_or_else(|_| "friends.json".into()),
    );
    let database = match std::fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Database::default(),
        Err(e) => return Err(e.into()),
    };
    let state = Arc::new(Mutex::new(Service {
        database,
        sessions: HashMap::new(),
        seen: HashMap::new(),
        file,
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001").await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn http_requests_are_private_and_acceptance_survives_reload() {
        let directory = std::env::temp_dir().join(format!("turtle-friends-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("friends.json");
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let c = Uuid::from_u128(3);
        let mut database = Database::default();
        let mut sessions = HashMap::new();
        for (id, name, token) in [
            (a, "Alice", "alice-session"),
            (b, "Bob", "bob-session"),
            (c, "Carol", "carol-session"),
        ] {
            database.users.insert(
                id,
                User {
                    name: name.into(),
                    ..User::default()
                },
            );
            sessions.insert(
                token.into(),
                Session {
                    player: id,
                    expires: Instant::now() + Duration::from_secs(60),
                },
            );
        }
        let state = Arc::new(Mutex::new(Service {
            database,
            sessions,
            seen: HashMap::new(),
            file: file.clone(),
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server =
            tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(format!("{base}/friends"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .post(format!("{base}/session"))
                .json(&serde_json::json!({"uuid":a}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .post(format!("{base}/friends/request"))
                .bearer_auth("alice-session")
                .json(&serde_json::json!({"name":"Bob"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        let carol: serde_json::Value = client
            .get(format!("{base}/friends"))
            .bearer_auth("carol-session")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(carol["incoming"], serde_json::json!([]));
        assert_eq!(
            client
                .post(format!("{base}/friends/decision"))
                .bearer_auth("carol-session")
                .json(&serde_json::json!({"uuid":a,"accept":true}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            client
                .post(format!("{base}/friends/decision"))
                .bearer_auth("bob-session")
                .json(&serde_json::json!({"uuid":a,"accept":true}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        let restored: Database = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(restored.users[&a].friends, BTreeSet::from([b]));
        assert_eq!(restored.users[&b].friends, BTreeSet::from([a]));
        assert_eq!(
            client
                .delete(format!("{base}/friends/{b}"))
                .bearer_auth("alice-session")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        let restored: Database = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert!(restored.users[&a].friends.is_empty());
        assert!(restored.users[&b].friends.is_empty());
        server.abort();
        let _ = server.await;
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn friendship_requires_receiver_consent_and_persists_both_sides() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let c = Uuid::from_u128(3);
        let mut db = Database::default();
        for (id, name) in [(a, "Alice"), (b, "Bob"), (c, "Carol")] {
            db.users.insert(
                id,
                User {
                    name: name.into(),
                    ..User::default()
                },
            );
        }
        request(&mut db, a, "bOB").unwrap();
        assert!(db.users[&a].friends.is_empty());
        assert_eq!(decide(&mut db, c, a, true), Err(StatusCode::NOT_FOUND));
        decide(&mut db, b, a, true).unwrap();
        let restored: Database = serde_json::from_slice(&serde_json::to_vec(&db).unwrap()).unwrap();
        assert_eq!(restored.users[&a].friends, BTreeSet::from([b]));
        assert_eq!(restored.users[&b].friends, BTreeSet::from([a]));
        assert!(restored.users[&b].incoming.is_empty());
    }
    #[test]
    fn unverified_or_expired_sessions_cannot_claim_a_uuid() {
        let mut service = Service {
            database: Database::default(),
            sessions: HashMap::new(),
            seen: HashMap::new(),
            file: PathBuf::new(),
        };
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer fake".parse().unwrap());
        assert_eq!(
            authenticated(&mut service, &headers),
            Err(StatusCode::UNAUTHORIZED)
        );
        service.sessions.insert(
            "fake".into(),
            Session {
                player: Uuid::from_u128(1),
                expires: Instant::now() - Duration::from_secs(1),
            },
        );
        assert_eq!(
            authenticated(&mut service, &headers),
            Err(StatusCode::UNAUTHORIZED)
        );
    }
}
