use std::{io::Read, time::Duration};
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert!(args.iter().any(|a| a == "--session-stdin"));
    assert!(!args.iter().any(|a| a.contains("fixture-private-token")));
    assert!(args.iter().any(|a| a == "--resources"));
    assert!(args.iter().any(|a| a == "--game-dir"));
    let mut session = String::new();
    std::io::stdin().read_to_string(&mut session).unwrap();
    assert!(session.contains("fixture-private-token"));
    assert!(session.contains("FixturePlayer"));
    let home = std::env::var_os("HORIZON_HOME").unwrap();
    std::fs::write(
        std::path::Path::new(&home).join("fixture-ready"),
        "private session received through stdin",
    )
    .unwrap();
    while !std::path::Path::new("fixture-exit").exists() {
        std::thread::sleep(Duration::from_millis(20));
    }
}
