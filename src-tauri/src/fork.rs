//! Boundaries of this independently branded fork. No upstream service credentials are used.
pub(crate) fn upstream_service(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    ["millida.net", "millida.trade", "millida.host"]
        .iter()
        .any(|base| host == *base || host.ends_with(&format!(".{base}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_services_are_separate_from_game_sources() {
        for host in ["millida.net", "api.millida.net", "CDN.MILLIDA.TRADE.", "voice.millida.host"] {
            assert!(upstream_service(host), "{host}");
        }
        for host in ["api.modrinth.com", "login.live.com", "piston-meta.mojang.com", "millida.net.example.org"] {
            assert!(!upstream_service(host), "{host}");
        }
    }
}
