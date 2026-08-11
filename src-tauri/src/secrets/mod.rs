//! Secrets module — OS keyring only; never sqlite.
pub mod keyring_store;

pub use keyring_store::{KeyringStore, KeyringStoreError, ProfileSecrets};
