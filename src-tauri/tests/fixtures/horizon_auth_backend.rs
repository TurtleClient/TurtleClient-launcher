//! Isolated public-CLI fixture. No network and no real accounts or credentials.
use std::{env, fs, path::PathBuf, thread, time::Duration};

fn main() {
    let home = PathBuf::from(env::var_os("HORIZON_LAUNCHER_HOME").unwrap());
    fs::create_dir_all(&home).unwrap();
    let signed_in = home.join("fixture-signed-in");
    let args: Vec<_> = env::args().collect();
    match args.get(3).map(String::as_str) {
        Some("sign-in") => {
            eprintln!("To sign in, open https://www.microsoft.com/link in a browser and enter the code ABCD1234");
            thread::sleep(Duration::from_millis(500));
            fs::write(signed_in, "fixture only").unwrap();
        }
        Some("list") if signed_in.exists() => println!("{{\"accounts\":[{{\"name\":\"TestPlayer\",\"uuid\":\"11111111111111111111111111111111\",\"selected\":true}}]}}"),
        Some("list") => println!("{{\"accounts\":[]}}"),
        Some("session") if signed_in.exists() => {
            let dir = PathBuf::from(env::var_os("HORIZON_HOME").unwrap()).join("sessions");
            fs::create_dir_all(&dir).unwrap();
            let file = dir.join("fixture.json");
            fs::write(&file, "{\"name\":\"TestPlayer\",\"uuid\":\"11111111111111111111111111111111\",\"user_type\":\"msa\",\"access_token\":\"test-only-token\"}").unwrap();
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
            }
            println!("{{\"session_file\":\"{}\"}}", file.to_string_lossy().replace('\\', "\\\\"));
        }
        _ => std::process::exit(1),
    }
}
