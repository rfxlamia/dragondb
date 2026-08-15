import type {
  ConnectionProfileDto,
  ProfileSecretsInput,
  SshAuthMethod,
  SslMode,
} from "../../ipc/contract";
import { ConnectionCopy } from "./connection-copy";
import { ConnectionStringFields } from "./connection-string-fields";

export type ConnectionFormProfileFields = Omit<ConnectionProfileDto, "id">;

export interface ConnectionFormValue {
  profile: ConnectionFormProfileFields;
  secrets: ProfileSecretsInput;
}

const SSL_MODES_ALL: SslMode[] = [
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
];

const SSL_MODES_SSH: SslMode[] = ["disable", "allow", "prefer", "require"];

type FileWithPath = File & { path?: string };

export function emptyConnectionFormValue(): ConnectionFormValue {
  return {
    profile: {
      name: null,
      host: "",
      port: 5432,
      username: "",
      database: "",
      isFavorite: false,
      sslMode: "prefer",
      sshEnabled: false,
      sshHost: null,
      sshPort: null,
      sshUsername: null,
      sshAuthMethod: null,
      sshPrivateKeyPath: null,
    },
    secrets: {},
  };
}

export function formValueFromProfile(profile: ConnectionProfileDto): ConnectionFormValue {
  return {
    profile: {
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      database: profile.database,
      isFavorite: profile.isFavorite,
      sslMode: profile.sslMode,
      sshEnabled: profile.sshEnabled,
      sshHost: profile.sshHost,
      sshPort: profile.sshPort,
      sshUsername: profile.sshUsername,
      sshAuthMethod: profile.sshAuthMethod,
      sshPrivateKeyPath: profile.sshPrivateKeyPath,
    },
    secrets: {},
  };
}

function patchProfile(
  value: ConnectionFormValue,
  patch: Partial<ConnectionFormProfileFields>,
): ConnectionFormValue {
  return { ...value, profile: { ...value.profile, ...patch } };
}

function patchSecrets(
  value: ConnectionFormValue,
  patch: Partial<ProfileSecretsInput>,
): ConnectionFormValue {
  return { ...value, secrets: { ...value.secrets, ...patch } };
}

export function ConnectionForm(props: {
  value: ConnectionFormValue;
  onChange: (next: ConnectionFormValue) => void;
  connectionStringMode?: boolean;
  onConnectionStringModeChange?: (next: boolean) => void;
  connectionStringValue?: string;
  onConnectionStringChange?: (next: string) => void;
  connectionStringReadOnly?: boolean;
  onCopyConnectionString?: () => void;
}): React.JSX.Element {
  const {
    value,
    onChange,
    connectionStringMode = false,
    onConnectionStringModeChange,
    connectionStringValue = "",
    onConnectionStringChange,
    connectionStringReadOnly = false,
    onCopyConnectionString,
  } = props;
  const { profile, secrets } = value;
  const sslModes = profile.sshEnabled ? SSL_MODES_SSH : SSL_MODES_ALL;
  const sshAuth: SshAuthMethod = profile.sshAuthMethod ?? "password";

  async function onPrivateKeyFile(file: File | undefined): Promise<void> {
    if (!file) return;
    const text = await file.text();
    const pathHint = (file as FileWithPath).path ?? file.name;
    onChange({
      profile: { ...profile, sshPrivateKeyPath: pathHint },
      secrets: { ...secrets, sshPrivateKey: text },
    });
  }

  return (
    <div className="connection-form">
      <label className="connection-form__field">
        <span>{ConnectionCopy.name}</span>
        <input
          type="text"
          value={profile.name ?? ""}
          onChange={(e) =>
            onChange(patchProfile(value, { name: e.target.value === "" ? null : e.target.value }))
          }
        />
      </label>

      <label className="connection-form__check">
        <input
          type="checkbox"
          checked={connectionStringMode}
          onChange={(event) => onConnectionStringModeChange?.(event.target.checked)}
        />
        <span>{ConnectionCopy.connectionStringMode}</span>
      </label>

      {connectionStringMode ? (
        <ConnectionStringFields
          value={connectionStringValue}
          onChange={(next) => onConnectionStringChange?.(next)}
          readOnly={connectionStringReadOnly}
          onCopy={() => onCopyConnectionString?.()}
        />
      ) : (
        <>
          <div className="connection-form__row">
            <label className="connection-form__field">
              <span>{ConnectionCopy.host}</span>
              <input
                type="text"
                value={profile.host}
                onChange={(e) => onChange(patchProfile(value, { host: e.target.value }))}
              />
            </label>
            <label className="connection-form__field">
              <span>{ConnectionCopy.port}</span>
              <input
                type="number"
                value={profile.port}
                onChange={(e) =>
                  onChange(patchProfile(value, { port: Number.parseInt(e.target.value, 10) || 0 }))
                }
              />
            </label>
          </div>

          <label className="connection-form__field">
            <span>{ConnectionCopy.username}</span>
            <input
              type="text"
              value={profile.username}
              onChange={(e) => onChange(patchProfile(value, { username: e.target.value }))}
            />
          </label>

          <label className="connection-form__field">
            <span>{ConnectionCopy.database}</span>
            <input
              type="text"
              value={profile.database}
              onChange={(e) => onChange(patchProfile(value, { database: e.target.value }))}
            />
          </label>

          <label className="connection-form__field">
            <span>{ConnectionCopy.password}</span>
            <input
              type="password"
              autoComplete="off"
              value={secrets.password ?? ""}
              onChange={(e) => onChange(patchSecrets(value, { password: e.target.value }))}
            />
          </label>
        </>
      )}

      <label className="connection-form__field">
        <span>{ConnectionCopy.ssl}</span>
        <select
          value={profile.sslMode}
          onChange={(e) => onChange(patchProfile(value, { sslMode: e.target.value as SslMode }))}
        >
          {sslModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <label className="connection-form__check">
        <input
          type="checkbox"
          checked={profile.sshEnabled}
          onChange={(e) => {
            const sshEnabled = e.target.checked;
            const nextSsl =
              sshEnabled && (profile.sslMode === "verify-ca" || profile.sslMode === "verify-full")
                ? ("prefer" as SslMode)
                : profile.sslMode;
            onChange(
              patchProfile(value, {
                sshEnabled,
                sslMode: nextSsl,
                sshAuthMethod: sshEnabled ? (profile.sshAuthMethod ?? "password") : null,
                sshHost: sshEnabled ? (profile.sshHost ?? "") : null,
                sshPort: sshEnabled ? (profile.sshPort ?? 22) : null,
                sshUsername: sshEnabled ? (profile.sshUsername ?? "") : null,
              }),
            );
          }}
        />
        <span>{ConnectionCopy.ssh}</span>
      </label>

      {profile.sshEnabled ? (
        <div className="connection-form__ssh">
          <p className="connection-form__ssh-title">{ConnectionCopy.ssh}</p>
          <div className="connection-form__row">
            <label className="connection-form__field">
              <span>{ConnectionCopy.sshHost}</span>
              <input
                type="text"
                value={profile.sshHost ?? ""}
                onChange={(e) => onChange(patchProfile(value, { sshHost: e.target.value }))}
              />
            </label>
            <label className="connection-form__field">
              <span>{ConnectionCopy.sshPort}</span>
              <input
                type="number"
                value={profile.sshPort ?? 22}
                onChange={(e) =>
                  onChange(
                    patchProfile(value, {
                      sshPort: Number.parseInt(e.target.value, 10) || 0,
                    }),
                  )
                }
              />
            </label>
          </div>

          <label className="connection-form__field">
            <span>{ConnectionCopy.sshUsername}</span>
            <input
              type="text"
              value={profile.sshUsername ?? ""}
              onChange={(e) => onChange(patchProfile(value, { sshUsername: e.target.value }))}
            />
          </label>

          <label className="connection-form__field">
            <span>{ConnectionCopy.sshAuthMethod}</span>
            <select
              value={sshAuth}
              onChange={(e) =>
                onChange(
                  patchProfile(value, {
                    sshAuthMethod: e.target.value as SshAuthMethod,
                  }),
                )
              }
            >
              <option value="password">{ConnectionCopy.sshAuthPassword}</option>
              <option value="privateKey">{ConnectionCopy.sshAuthPrivateKey}</option>
            </select>
          </label>

          {sshAuth === "password" ? (
            <label className="connection-form__field">
              <span>{ConnectionCopy.sshPassword}</span>
              <input
                type="password"
                autoComplete="off"
                value={secrets.sshPassword ?? ""}
                onChange={(e) => onChange(patchSecrets(value, { sshPassword: e.target.value }))}
              />
            </label>
          ) : (
            <>
              <label className="connection-form__field">
                <span>{ConnectionCopy.privateKey}</span>
                <input
                  type="file"
                  onChange={(e) => {
                    void onPrivateKeyFile(e.target.files?.[0]);
                  }}
                />
              </label>
              <label className="connection-form__field">
                <span>{ConnectionCopy.sshPassphrase}</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={secrets.sshPassphrase ?? ""}
                  onChange={(e) => onChange(patchSecrets(value, { sshPassphrase: e.target.value }))}
                />
              </label>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
