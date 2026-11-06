// Isolated HTTP test: no real profiles, capes, friends or Ocean files are touched.
use super::{wardrobe::*, *};
#[tokio::test]
async fn wardrobe_uses_verified_owner_and_reloads_server_categories() {
    let dir = std::env::temp_dir().join(format!("turtle-wardrobe-{}", Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("data/turtle-cosmetics")).unwrap();
    let id = Uuid::from_u128(1);
    let mut database = Database::default();
    database.users.insert(
        id,
        User {
            name: "Fixture".into(),
            ..User::default()
        },
    );
    let sessions = HashMap::from([(
        "fixture-session".into(),
        Session {
            player: id,
            expires: Instant::now() + Duration::from_secs(60),
        },
    )]);
    let auth = Arc::new(Mutex::new(Service {
        database,
        sessions,
        seen: HashMap::new(),
        file: dir.join("friends.json"),
    }));
    std::fs::write(
        dir.join("data/turtle-cosmetics/wardrobe.json"),
        serde_json::to_vec(
            &serde_json::json!({"equipped":{id.to_string():{"head":"fixture_hat"}}}),
        )
        .unwrap(),
    )
    .unwrap();
    let categories = dir.join("categories.json");
    std::fs::write(
        &categories,
        include_str!("../wardrobe-categories.example.json"),
    )
    .unwrap();
    let seen = Arc::new(Mutex::new(String::new()));
    let capture = seen.clone();
    let ocean_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ocean = format!("http://{}", ocean_listener.local_addr().unwrap());
    let fake = Router::new().route(
        "/api/cosmetics/equip/:uuid",
        post(move |Path(uuid): Path<String>| {
            let capture = capture.clone();
            async move {
                *capture.lock().unwrap() = uuid;
                StatusCode::NO_CONTENT
            }
        }),
    );
    let ocean_task = tokio::spawn(async move { axum::serve(ocean_listener, fake).await.unwrap() });
    let service = test_router(auth, dir.clone(), categories.clone(), ocean);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, service).await.unwrap() });
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{base}/wardrobe"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let value: serde_json::Value = client
        .get(format!("{base}/wardrobe"))
        .bearer_auth("fixture-session")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(value["equipped"]["head"], "fixture_hat");
    assert_eq!(
        client
            .post(format!("{base}/wardrobe"))
            .bearer_auth("fixture-session")
            .json(
                &serde_json::json!({"uuid":Uuid::from_u128(2),"slot":"head","item":"fixture_hat"})
            )
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(client
        .post(format!("{base}/wardrobe"))
        .bearer_auth("fixture-session")
        .json(&serde_json::json!({"slot":"head","item":null}))
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert_eq!(*seen.lock().unwrap(), id.to_string());
    std::fs::write(&categories,serde_json::to_vec(&serde_json::json!({"categories":[{"id":"special","label":{"en":"Special"},"slots":[]}],"assignments":{"fixture_hat":"special"}})).unwrap()).unwrap();
    let value: serde_json::Value = client
        .get(format!("{base}/wardrobe/categories"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(value["assignments"]["fixture_hat"], "special");
    std::fs::write(&categories,serde_json::to_vec(&serde_json::json!({"categories":[{"id":"special","label":{"en":"Special"},"slots":[]}],"items":{"fixture_hat":{"type":"HAT","access":"paid","price_minor":999,"currency":"EUR"}}})).unwrap()).unwrap();
    let action = serde_json::json!({"slot":"head","item":"fixture_hat"});
    assert_eq!(
        client
            .post(format!("{base}/wardrobe"))
            .bearer_auth("fixture-session")
            .json(&action)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    std::fs::write(
        categories.with_file_name("wardrobe-entitlements.json"),
        serde_json::to_vec(&serde_json::json!({"players":{id.to_string():["fixture_hat"]}}))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        client
            .post(format!("{base}/wardrobe"))
            .bearer_auth("fixture-session")
            .json(&action)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    task.abort();
    ocean_task.abort();
    let _ = task.await;
    let _ = ocean_task.await;
    std::fs::remove_dir_all(dir).unwrap();
}
