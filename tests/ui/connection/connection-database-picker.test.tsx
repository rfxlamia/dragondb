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
});
