//! SSH auth: password or private-key **contents** (not path reads).
//!
//! Keyring stores PEM/OpenSSH text; callers pass contents into this module.
//! `build_auth_method` validates and selects a variant; russh parse is separate
//! (`parse_private_key_for_russh`) so unit tests need no cryptographic fixture.

use thiserror::Error;

/// Raw auth inputs from the session / keyring layer.
#[derive(Debug, Clone)]
pub enum SshAuthInput {
    Password { password: String },
    PrivateKey {
        key_contents: String,
        passphrase: Option<String>,
    },
}

/// Validated auth ready for tunnel connect (contents still unparsed for key path).
#[derive(Debug, Clone)]
pub enum PreparedAuth {
    Password(String),
    PrivateKey {
        key_contents: String,
        passphrase: Option<String>,
    },
}

/// Auth preparation / validation errors.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SshAuthError {
    #[error("SSH private key is empty")]
    EmptyPrivateKey,
    #[error("SSH private key could not be parsed: {0}")]
    InvalidPrivateKey(String),
}

/// Validate and select password vs private-key-contents auth.
///
/// Does **not** read key files from disk — callers must pass keyring contents.
pub fn build_auth_method(input: SshAuthInput) -> Result<PreparedAuth, SshAuthError> {
    match input {
        SshAuthInput::Password { password } => Ok(PreparedAuth::Password(password)),
        SshAuthInput::PrivateKey {
            key_contents,
            passphrase,
        } => {
            if key_contents.trim().is_empty() {
                return Err(SshAuthError::EmptyPrivateKey);
            }
            Ok(PreparedAuth::PrivateKey {
                key_contents,
                passphrase,
            })
        }
    }
}

/// Parse prepared key contents into a russh `PrivateKey` (live connect path).
///
/// Unit prepare tests intentionally skip this — incomplete PEM stubs are OK
/// for `build_auth_method` only.
pub fn parse_private_key_for_russh(
    key_contents: &str,
    passphrase: Option<&str>,
) -> Result<russh::keys::PrivateKey, SshAuthError> {
    russh::keys::decode_secret_key(key_contents, passphrase).map_err(|e| {
        SshAuthError::InvalidPrivateKey(e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_auth_selects_password_variant() {
        let method = build_auth_method(SshAuthInput::Password {
            password: "hunter2".into(),
        })
        .expect("password auth");
        assert!(matches!(method, PreparedAuth::Password(_)));
    }

    #[test]
    fn private_key_contents_with_passphrase_prepares_key_auth() {
        // Unit seam: validate + select PrivateKey variant from contents.
        // Do not require russh to parse a cryptographic fixture here.
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nLINE1\nLINE2\n-----END OPENSSH PRIVATE KEY-----";
        let method = build_auth_method(SshAuthInput::PrivateKey {
            key_contents: pem.into(),
            passphrase: Some("phrase".into()),
        })
        .expect("key auth");
        assert!(matches!(method, PreparedAuth::PrivateKey { .. }));
    }

    #[test]
    fn empty_private_key_contents_are_rejected() {
        let err = build_auth_method(SshAuthInput::PrivateKey {
            key_contents: "   ".into(),
            passphrase: None,
        })
        .expect_err("empty key");
        assert!(matches!(err, SshAuthError::EmptyPrivateKey));
    }
}
