/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionForm } from "../../../src/ui/connection/connection-form";

afterEach(() => cleanup());

describe("ConnectionForm SSH key pick", () => {
  it("stores private key file contents in secrets and path hint on profile", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConnectionForm
        value={{
          profile: {
            name: null,
            host: "127.0.0.1",
            port: 5432,
            username: "u",
            database: "d",
            isFavorite: false,
            sslMode: "prefer",
            sshEnabled: true,
            sshHost: "bastion",
            sshPort: 22,
            sshUsername: "ubuntu",
            sshAuthMethod: "privateKey",
            sshPrivateKeyPath: null,
          },
          secrets: {},
        }}
        onChange={onChange}
      />,
    );

    const file = new File(
      ["-----BEGIN OPENSSH PRIVATE KEY-----\nKEYDATA\n-----END OPENSSH PRIVATE KEY-----"],
      "id_ed25519",
      { type: "application/octet-stream" },
    );
    // Path hint: browsers expose File.name; Tauri dialog may supply full path — assert name at minimum.
    Object.defineProperty(file, "path", { value: "/Users/me/.ssh/id_ed25519" });
    const input = screen.getByLabelText(/private key|ssh key/i);
    await user.upload(input, file);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last.secrets.sshPrivateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(last.profile.sshPrivateKeyPath).toMatch(/id_ed25519/);
  });
});
