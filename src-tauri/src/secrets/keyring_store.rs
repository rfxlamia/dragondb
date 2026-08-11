//! Profile secrets stored in the OS keyring (never sqlite).
//!
//! # Account naming
//!
//! Service name is typically `"dragondb"`. Per-profile account names:
//! - `{profileId}/password`
//! - `{profileId}/sshPassword`
//! - `{profileId}/sshPassphrase`
//! - `{profileId}/sshPrivateKey`
//!
//! Unit tests use [`KeyringStore::memory`]; production and ignored
//! integration tests use [`KeyringStore::new`] against the real OS keyring.
//! Never log secret values.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use keyring::Entry;
use thiserror::Error;

const SLOT_PASSWORD: &str = "password";
const SLOT_SSH_PASSWORD: &str = "sshPassword";
const SLOT_SSH_PASSPHRASE: &str = "sshPassphrase";
const SLOT_SSH_PRIVATE_KEY: &str = "sshPrivateKey";

const ALL_SLOTS: &[&str] = &[
    SLOT_PASSWORD,
    SLOT_SSH_PASSWORD,
    SLOT_SSH_PASSPHRASE,
    SLOT_SSH_PRIVATE_KEY,
];

fn account_name(profile_id: &str, slot: &str) -> String {
    format!("{profile_id}/{slot}")
}

/// Secret payload for a connection profile. Never persisted to sqlite.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct ProfileSecrets {
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_passphrase: Option<String>,
    pub ssh_private_key: Option<String>,
}

impl std::fmt::Debug for ProfileSecrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProfileSecrets")
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field(
                "ssh_password",
                &self.ssh_password.as_ref().map(|_| "<redacted>"),
            )
            .field(
                "ssh_passphrase",
                &self.ssh_passphrase.as_ref().map(|_| "<redacted>"),
            )
            .field(
                "ssh_private_key",
                &self.ssh_private_key.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

impl ProfileSecrets {
    fn is_empty(&self) -> bool {
        self.password.is_none()
            && self.ssh_password.is_none()
            && self.ssh_passphrase.is_none()
            && self.ssh_private_key.is_none()
    }
}

#[derive(Debug, Error)]
pub enum KeyringStoreError {
    #[error("no secrets found for profile {profile_id}")]
    NotFound { profile_id: String },
    #[error("keyring backend error: {0}")]
    Backend(String),
}

enum Backend {
    Os { service: String },
    Memory(Arc<Mutex<HashMap<String, String>>>),
}

/// Keyring-backed store for profile secrets.
pub struct KeyringStore {
    backend: Backend,
}

impl KeyringStore {
    /// Production store using the OS keyring under `service` (e.g. `"dragondb"`).
    pub fn new(service: &str) -> Self {
        Self {
            backend: Backend::Os {
                service: service.to_string(),
            },
        }
    }

    /// In-memory seam for unit tests — does not touch the OS keyring.
    pub fn memory() -> Self {
        Self {
            backend: Backend::Memory(Arc::new(Mutex::new(HashMap::new()))),
        }
    }

    pub fn set_secrets(
        &self,
        profile_id: &str,
        secrets: &ProfileSecrets,
    ) -> Result<(), KeyringStoreError> {
        // Empty string means "omit / do not update" — never wipe a slot with "".
        if let Some(ref v) = secrets.password {
            if !v.is_empty() {
                self.set_slot(profile_id, SLOT_PASSWORD, v)?;
            }
        }
        if let Some(ref v) = secrets.ssh_password {
            if !v.is_empty() {
                self.set_slot(profile_id, SLOT_SSH_PASSWORD, v)?;
            }
        }
        if let Some(ref v) = secrets.ssh_passphrase {
            if !v.is_empty() {
                self.set_slot(profile_id, SLOT_SSH_PASSPHRASE, v)?;
            }
        }
        if let Some(ref v) = secrets.ssh_private_key {
            if !v.is_empty() {
                self.set_slot(profile_id, SLOT_SSH_PRIVATE_KEY, v)?;
            }
        }
        Ok(())
    }

    pub fn get_secrets(&self, profile_id: &str) -> Result<ProfileSecrets, KeyringStoreError> {
        let secrets = ProfileSecrets {
            password: self.get_slot(profile_id, SLOT_PASSWORD)?,
            ssh_password: self.get_slot(profile_id, SLOT_SSH_PASSWORD)?,
            ssh_passphrase: self.get_slot(profile_id, SLOT_SSH_PASSPHRASE)?,
            ssh_private_key: self.get_slot(profile_id, SLOT_SSH_PRIVATE_KEY)?,
        };
        if secrets.is_empty() {
            return Err(KeyringStoreError::NotFound {
                profile_id: profile_id.to_string(),
            });
        }
        Ok(secrets)
    }

    pub fn delete_all_for_profile(&self, profile_id: &str) -> Result<(), KeyringStoreError> {
        for slot in ALL_SLOTS {
            self.delete_slot(profile_id, slot)?;
        }
        Ok(())
    }

    fn set_slot(&self, profile_id: &str, slot: &str, value: &str) -> Result<(), KeyringStoreError> {
        let account = account_name(profile_id, slot);
        match &self.backend {
            Backend::Os { service } => {
                let entry = Entry::new(service, &account)
                    .map_err(|e| KeyringStoreError::Backend(e.to_string()))?;
                entry
                    .set_password(value)
                    .map_err(|e| KeyringStoreError::Backend(e.to_string()))?;
            }
            Backend::Memory(map) => {
                let mut guard = map
                    .lock()
                    .map_err(|_| KeyringStoreError::Backend("memory lock poisoned".into()))?;
                guard.insert(account, value.to_string());
            }
        }
        Ok(())
    }

    fn get_slot(
        &self,
        profile_id: &str,
        slot: &str,
    ) -> Result<Option<String>, KeyringStoreError> {
        let account = account_name(profile_id, slot);
        match &self.backend {
            Backend::Os { service } => {
                let entry = Entry::new(service, &account)
                    .map_err(|e| KeyringStoreError::Backend(e.to_string()))?;
                match entry.get_password() {
                    Ok(v) => Ok(Some(v)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(e) => Err(KeyringStoreError::Backend(e.to_string())),
                }
            }
            Backend::Memory(map) => {
                let guard = map
                    .lock()
                    .map_err(|_| KeyringStoreError::Backend("memory lock poisoned".into()))?;
                Ok(guard.get(&account).cloned())
            }
        }
    }

    fn delete_slot(&self, profile_id: &str, slot: &str) -> Result<(), KeyringStoreError> {
        let account = account_name(profile_id, slot);
        match &self.backend {
            Backend::Os { service } => {
                let entry = Entry::new(service, &account)
                    .map_err(|e| KeyringStoreError::Backend(e.to_string()))?;
                match entry.delete_credential() {
                    Ok(()) => Ok(()),
                    Err(keyring::Error::NoEntry) => Ok(()),
                    Err(e) => Err(KeyringStoreError::Backend(e.to_string())),
                }
            }
            Backend::Memory(map) => {
                let mut guard = map
                    .lock()
                    .map_err(|_| KeyringStoreError::Backend("memory lock poisoned".into()))?;
                guard.remove(&account);
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_profile_id() -> String {
        format!("test-{}", Uuid::new_v4())
    }

    #[test]
    fn set_then_get_password_round_trips() {
        let profile_id = test_profile_id();
        let store = KeyringStore::memory(); // in-memory seam — no OS keyring
        let secrets = ProfileSecrets {
            password: Some("s3cret".into()),
            ssh_password: None,
            ssh_passphrase: None,
            ssh_private_key: None,
        };
        store.set_secrets(&profile_id, &secrets).expect("set");
        let got = store.get_secrets(&profile_id).expect("get");
        assert_eq!(got.password.as_deref(), Some("s3cret"));
        store.delete_all_for_profile(&profile_id).expect("cleanup");
    }

    #[test]
    fn delete_all_for_profile_removes_all_slots() {
        let profile_id = test_profile_id();
        let store = KeyringStore::memory();
        store
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: Some("a".into()),
                    ssh_password: Some("b".into()),
                    ssh_passphrase: Some("c".into()),
                    ssh_private_key: Some(
                        "-----BEGIN OPENSSH PRIVATE KEY-----\nk\n-----END OPENSSH PRIVATE KEY-----"
                            .into(),
                    ),
                },
            )
            .expect("set");
        store.delete_all_for_profile(&profile_id).expect("delete");
        let err = store.get_secrets(&profile_id).expect_err("must be missing");
        assert!(matches!(err, KeyringStoreError::NotFound { .. }));
    }

    #[test]
    fn ssh_private_key_stores_full_pem_contents_not_path() {
        let profile_id = test_profile_id();
        let store = KeyringStore::memory();
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nLINE1\nLINE2\n-----END OPENSSH PRIVATE KEY-----";
        store
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: None,
                    ssh_password: None,
                    ssh_passphrase: Some("phrase".into()),
                    ssh_private_key: Some(pem.into()),
                },
            )
            .expect("set");
        let got = store.get_secrets(&profile_id).expect("get");
        assert_eq!(got.ssh_private_key.as_deref(), Some(pem));
        assert!(!got
            .ssh_private_key
            .as_deref()
            .unwrap_or("")
            .contains("/tmp/"));
        store.delete_all_for_profile(&profile_id).expect("cleanup");
    }

    #[test]
    fn empty_string_secrets_do_not_overwrite_existing_slots() {
        let profile_id = test_profile_id();
        let store = KeyringStore::memory();
        store
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: Some("keep-me".into()),
                    ..Default::default()
                },
            )
            .expect("set");
        store
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: Some(String::new()),
                    ssh_password: Some(String::new()),
                    ..Default::default()
                },
            )
            .expect("omit empties");
        let got = store.get_secrets(&profile_id).expect("get");
        assert_eq!(got.password.as_deref(), Some("keep-me"));
        store.delete_all_for_profile(&profile_id).expect("cleanup");
    }
}
