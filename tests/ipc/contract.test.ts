// Note: vitest does not typecheck by itself — red/green for types uses
// `bun run typecheck` (step 2/4). Runtime asserts below catch missing symbols.
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  ProfileId,
  ProfileSecretsInput,
  SaveProfileInput,
  SshAuthMethod,
  SslMode,
} from "../../src/ipc/contract";
import * as contract from "../../src/ipc/contract";

describe("DragonIpc contract delta (SP-2)", () => {
  it("exports SSL / SSH union literals used by DTOs", () => {
    expectTypeOf<SslMode>().toEqualTypeOf<
      "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full"
    >();
    expectTypeOf<SshAuthMethod>().toEqualTypeOf<"password" | "privateKey">();
    const sslModes: SslMode[] = [
      "disable",
      "allow",
      "prefer",
      "require",
      "verify-ca",
      "verify-full",
    ];
    const sshAuth: SshAuthMethod[] = ["password", "privateKey"];
    expect(sslModes).toHaveLength(6);
    expect(sshAuth).toHaveLength(2);
    const id: ProfileId = "00000000-0000-4000-8000-000000000001";
    expect(typeof id).toBe("string");
  });

  it("ConnectionProfileDto never includes secret fields", () => {
    const profile: ConnectionProfileDto = {
      id: "p1",
      name: "local",
      host: "127.0.0.1",
      port: 5432,
      username: "postgres",
      database: "app",
      isFavorite: false,
      sslMode: "prefer",
      sshEnabled: false,
      sshHost: null,
      sshPort: null,
      sshUsername: null,
      sshAuthMethod: null,
      sshPrivateKeyPath: null,
    };
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("sshPassword");
    expect(profile).not.toHaveProperty("sshPassphrase");
    expect(profile).not.toHaveProperty("sshPrivateKey");
  });

  it("SaveProfileInput carries optional id + secrets separately from profile", () => {
    const secrets: ProfileSecretsInput = {
      password: "secret",
      sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----",
    };
    const createInput: SaveProfileInput = {
      profile: {
        name: null,
        host: "db.example",
        port: 5432,
        username: "u",
        database: "d",
        isFavorite: false,
        sslMode: "require",
        sshEnabled: true,
        sshHost: "bastion",
        sshPort: 22,
        sshUsername: "ubuntu",
        sshAuthMethod: "privateKey",
        sshPrivateKeyPath: "/tmp/id_ed25519",
      },
      secrets,
    };
    const updateInput: SaveProfileInput = {
      id: "00000000-0000-4000-8000-000000000001",
      profile: createInput.profile,
      secrets,
    };
    expect(createInput.secrets.password).toBe("secret");
    expect(createInput.profile).not.toHaveProperty("password");
    expect(updateInput.id).toBe("00000000-0000-4000-8000-000000000001");
    expectTypeOf<SaveProfileInput>().toHaveProperty("id");
    expectTypeOf<SaveProfileInput>().toHaveProperty("profile");
    expectTypeOf<SaveProfileInput>().toHaveProperty("secrets");
  });

  it("DragonIpc type requires profile CRUD + connect/disconnect + query trio", () => {
    const stub: DragonIpc = {
      listProfiles: async () => [],
      getProfile: async () => null,
      saveProfile: async () => {
        throw new Error("unimplemented");
      },
      deleteProfile: async () => {},
      connectProfile: async () => ({ connectionId: "c", profileId: "p" }) satisfies ConnectResult,
      disconnect: async () => {},
      listTables: async () => [],
      listColumns: async () => [],
      runQuery: async () => ({
        columns: [],
        rows: [],
        rowsAffected: null,
        durationMs: 0,
      }),
    };
    expectTypeOf(stub).toMatchTypeOf<DragonIpc>();
    expect(Object.keys(stub).sort()).toEqual(
      [
        "connectProfile",
        "deleteProfile",
        "disconnect",
        "getProfile",
        "listColumns",
        "listProfiles",
        "listTables",
        "runQuery",
        "saveProfile",
      ].sort(),
    );
    expect(contract).toBeTruthy();
  });
});
