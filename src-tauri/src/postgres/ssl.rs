//! SSL mode collapse for Postgres connections (Swift parity table).

use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;

/// Effective TLS path after collapsing UI `sslMode` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectiveTls {
    /// Plain TCP — no TLS handshake.
    NoTls,
    /// TLS without certificate verification (`require`).
    TlsNoVerify,
    /// TLS with certificate verification (`verify-ca` / `verify-full`).
    TlsVerify,
}

/// Collapse UI sslMode into the three effective TLS paths from the SP-2 spec table.
///
/// `allow` and `prefer` are treated as disable (NoTls). Unknown / mistyped values
/// also map to NoTls (UI enums are the source of truth; do not invent TLS).
pub fn collapse_ssl_mode(mode: &str) -> EffectiveTls {
    match mode.trim().to_ascii_lowercase().as_str() {
        "disable" | "allow" | "prefer" => EffectiveTls::NoTls,
        "require" => EffectiveTls::TlsNoVerify,
        "verify-ca" | "verify-full" => EffectiveTls::TlsVerify,
        _ => EffectiveTls::NoTls,
    }
}

/// Build a `MakeTlsConnector` for TLS connect paths.
pub fn make_tls_connector(
    tls: EffectiveTls,
) -> Result<Option<MakeTlsConnector>, native_tls::Error> {
    match tls {
        EffectiveTls::NoTls => Ok(None),
        EffectiveTls::TlsNoVerify => {
            let connector = TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .build()?;
            Ok(Some(MakeTlsConnector::new(connector)))
        }
        EffectiveTls::TlsVerify => {
            let connector = TlsConnector::builder().build()?;
            Ok(Some(MakeTlsConnector::new(connector)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapse_ssl_mode_matches_spec_table() {
        assert_eq!(collapse_ssl_mode("disable"), EffectiveTls::NoTls);
        assert_eq!(collapse_ssl_mode("allow"), EffectiveTls::NoTls);
        assert_eq!(collapse_ssl_mode("prefer"), EffectiveTls::NoTls);
        assert_eq!(collapse_ssl_mode("require"), EffectiveTls::TlsNoVerify);
        assert_eq!(collapse_ssl_mode("verify-ca"), EffectiveTls::TlsVerify);
        assert_eq!(collapse_ssl_mode("verify-full"), EffectiveTls::TlsVerify);
        assert_eq!(collapse_ssl_mode("Require"), EffectiveTls::TlsNoVerify);
        assert_eq!(collapse_ssl_mode(" unknown "), EffectiveTls::NoTls);
    }
}
