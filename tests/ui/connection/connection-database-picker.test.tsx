/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionDatabasePicker } from "../../../src/ui/connection/connection-database-picker";

afterEach(() => cleanup());

describe("ConnectionDatabasePicker", () => {
  it("is disabled until connected", () => {
    render(
      <ConnectionDatabasePicker
        isConnected={false}
        databases={["postgres"]}
        selected={null}
        onSelect={vi.fn()}
        profileDatabase="postgres"
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("switch calls onSelect(shop) without rewriting profileDatabase", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres", "shop"]}
        selected="postgres"
        onSelect={onSelect}
        profileDatabase="postgres"
      />,
    );
    await user.selectOptions(screen.getByRole("combobox"), "shop");
    expect(onSelect).toHaveBeenCalledWith("shop");
    expect(screen.getByText("postgres")).toBeInTheDocument();
  });

  it("reports a blocking surface while the create dialog is open", async () => {
    const user = userEvent.setup();
    const onBlockingChange = vi.fn();
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        profileDatabase="postgres"
        onCreateDatabase={vi.fn()}
        onBlockingChange={onBlockingChange}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));

    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });

  it("reports no blocking surface after the create dialog closes", async () => {
    const user = userEvent.setup();
    const onBlockingChange = vi.fn();
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        profileDatabase="postgres"
        onCreateDatabase={vi.fn()}
        onBlockingChange={onBlockingChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });

  it("clears blocking when disconnected unmounts the picker", async () => {
    const user = userEvent.setup();
    const onBlockingChange = vi.fn();
    const { rerender } = render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        profileDatabase="postgres"
        onCreateDatabase={vi.fn()}
        onBlockingChange={onBlockingChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ConnectionDatabasePicker
        isConnected={false}
        databases={[]}
        selected={null}
        onSelect={vi.fn()}
        profileDatabase="postgres"
        onBlockingChange={onBlockingChange}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });

  it("surfaces a failed switch and keeps the previous selection", async () => {
    // The parent starts an async switchDatabase; a rejection must reach the
    // picker rather than escaping as an unhandled rejection with no UI change.
    const user = userEvent.setup();
    const onSelect = vi.fn(async () => {
      throw new Error("switch failed");
    });
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres", "shop"]}
        selected="postgres"
        onSelect={onSelect}
        profileDatabase="postgres"
      />,
    );
    await user.selectOptions(screen.getByRole("combobox"), "shop");
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(ConnectionCopy.databaseSwitchError);
    });
    expect(screen.getByRole("combobox")).toHaveValue("postgres");
  });

  it("disables the picker while a switch is in flight", async () => {
    const user = userEvent.setup();
    const gate: Array<() => void> = [];
    const onSelect = vi.fn(() => new Promise<void>((resolve) => gate.push(resolve)));
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres", "shop"]}
        selected="postgres"
        onSelect={onSelect}
        profileDatabase="postgres"
      />,
    );
    await user.selectOptions(screen.getByRole("combobox"), "shop");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeDisabled());
    for (const release of gate) release();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  });

  it("missing selected database shows pulse Select DB", () => {
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected={null}
        onSelect={vi.fn()}
        profileDatabase="postgres"
        missingFromList
      />,
    );
    expect(screen.getByText(ConnectionCopy.selectDbPulse)).toBeInTheDocument();
  });

  it("create failure leaves selected database unchanged", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => {
      throw new Error("create failed");
    });
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        onCreateDatabase={onCreate}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    await user.type(screen.getByLabelText(ConnectionCopy.databaseName), "shop");
    await user.click(screen.getByRole("button", { name: ConnectionCopy.create }));
    expect(screen.getByRole("combobox")).toHaveValue("postgres");
    expect(screen.getByText(ConnectionCopy.createDatabaseError)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: ConnectionCopy.createDatabase })).toBeInTheDocument();
  });

  it("create dialog clears the name field when closed and reopened", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        onCreateDatabase={vi.fn(async () => undefined)}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    const nameField = screen.getByLabelText(ConnectionCopy.databaseName);
    await user.type(nameField, "shop");
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    expect(screen.getByLabelText(ConnectionCopy.databaseName)).toHaveValue("");
  });

  it("delete failure rolls picker back to the pre-delete snapshot", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => {
      throw new Error("drop failed");
    });
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres", "shop"]}
        selected="shop"
        onSelect={vi.fn()}
        onDeleteDatabase={onDelete}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.deleteDatabase }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.confirmDelete }));
    expect(screen.getByRole("combobox")).toHaveValue("shop");
    expect(screen.getByText(ConnectionCopy.deleteDatabaseError)).toBeInTheDocument();
  });

  it("keeps the create sheet open with Connect after create succeeds", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => undefined);
    const onConnect = vi.fn(async () => undefined);
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        onCreateDatabase={onCreate}
        onConnectDatabase={onConnect}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    await user.type(screen.getByLabelText(ConnectionCopy.databaseName), "shop{Enter}");
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("shop"));
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: ConnectionCopy.createDatabase })).toBeInTheDocument();
    expect(screen.getByText(ConnectionCopy.databaseCreated)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ConnectionCopy.connect })).toBeEnabled();
  });

  it("does not capture window keydown and keeps native typing and Cancel", async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(window, "addEventListener");
    const onCreate = vi.fn(async () => undefined);
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        onCreateDatabase={onCreate}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    const capturingKeydown = add.mock.calls.filter(([type, , options]) => {
      if (type !== "keydown") return false;
      return options === true || (typeof options === "object" && options?.capture === true);
    });
    expect(capturingKeydown).toHaveLength(0);
    add.mockRestore();

    const name = screen.getByLabelText(ConnectionCopy.databaseName) as HTMLInputElement;
    await user.type(name, "shop");
    name.setSelectionRange(2, 2);
    await user.keyboard("X");
    expect(name).toHaveValue("shXop");

    name.setSelectionRange(0, 5);
    await user.keyboard("ab");
    expect(name).toHaveValue("ab");

    await user.click(screen.getByRole("combobox"));
    await user.keyboard("z");
    expect(name).toHaveValue("ab");

    screen.getByRole("button", { name: ConnectionCopy.cancel }).focus();
    await user.keyboard("{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: ConnectionCopy.createDatabase })).toBeNull();
  });

  it("activates Cancel with Space and ignores keys while a button is focused", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        onCreateDatabase={vi.fn(async () => undefined)}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    const name = screen.getByLabelText(ConnectionCopy.databaseName);
    await user.type(name, "shop");
    const cancel = screen.getByRole("button", { name: ConnectionCopy.cancel });
    cancel.focus();
    await user.keyboard("x");
    expect(name).toHaveValue("shop");
    await user.keyboard(" ");
    expect(screen.queryByRole("dialog", { name: ConnectionCopy.createDatabase })).toBeNull();
  });

  it("lets Cancel and Escape work after Connect resolves without a switch", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionDatabasePicker
        isConnected={true}
        databases={["postgres"]}
        selected="postgres"
        onSelect={vi.fn()}
        onCreateDatabase={vi.fn(async () => undefined)}
        profileDatabase="postgres"
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    await user.type(screen.getByLabelText(ConnectionCopy.databaseName), "shop{Enter}");
    await screen.findByText(ConnectionCopy.databaseCreated);
    await user.click(screen.getByRole("button", { name: ConnectionCopy.connect }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: ConnectionCopy.cancel })).toBeEnabled();
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: ConnectionCopy.createDatabase })).toBeNull();
  });
});
