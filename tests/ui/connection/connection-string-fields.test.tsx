/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionAccessibility } from "../../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionStringFields } from "../../../src/ui/connection/connection-string-fields";

afterEach(() => cleanup());

describe("ConnectionStringFields", () => {
  it("edits a writable URI on a new profile", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConnectionStringFields
        value=""
        onChange={onChange}
        readOnly={false}
        errorMessage={null}
        onCopy={vi.fn()}
      />,
    );
    await user.type(
      screen.getByTestId(ConnectionAccessibility.connectionStringField),
      "postgres://alice@localhost:5432/app",
    );
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByTestId(ConnectionAccessibility.connectionStringField)).not.toHaveAttribute(
      "readonly",
    );
  });

  it("is read-only in edit mode and Copy invokes onCopy", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <ConnectionStringFields
        value="postgresql://alice:YOUR_PASSWORD@localhost/app"
        onChange={vi.fn()}
        readOnly={true}
        errorMessage={null}
        onCopy={onCopy}
      />,
    );
    expect(screen.getByTestId(ConnectionAccessibility.connectionStringField)).toHaveAttribute(
      "readonly",
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.copyConnectionString }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
});
