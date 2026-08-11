// Run locally on macOS exit: `cargo test --test keyring_restart_round_trip -- --ignored --nocapture`
// Default CI keeps this ignored (requires OS keyring).
use dragondb_lib::secrets::keyring_store::{KeyringStore, ProfileSecrets};
use uuid::Uuid;

#[test]
#[ignore = "requires OS keyring — run locally on macOS exit checklist"]
fn secrets_survive_store_reconstruction() {
    let profile_id = format!("restart-{}", Uuid::new_v4());
    {
        let store = KeyringStore::new("dragondb");
        store
            .set_secrets(
                &profile_id,
                &ProfileSecrets {
                    password: Some("persist-me".into()),
                    ssh_password: None,
                    ssh_passphrase: None,
                    ssh_private_key: None,
                },
            )
            .expect("set before restart");
    }
    // Drop + reconstruct Entry handles (simulates app relaunch in-process).
    let store2 = KeyringStore::new("dragondb");
    let got = store2.get_secrets(&profile_id).expect("get after restart");
    assert_eq!(got.password.as_deref(), Some("persist-me"));
    store2.delete_all_for_profile(&profile_id).expect("cleanup");
}
