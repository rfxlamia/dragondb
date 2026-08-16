/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionCreatedDialog } from "../../../src/ui/connection/connection-created-dialog";

afterEach(() => cleanup());

describe("ConnectionCreatedDialog", () => {
  it("Not Now dismisses without connect", async () => {
    const user = userEvent.setup();
    const onConnectNow = vi.fn();
    const onNotNow = vi.fn();
    render(<ConnectionCreatedDialog open onConnectNow={onConnectNow} onNotNow={onNotNow} />);
    expect(screen.getByText(ConnectionCopy.connectionCreated)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.notNow }));
    expect(onNotNow).toHaveBeenCalledOnce();
    expect(onConnectNow).not.toHaveBeenCalled();
  });

  it("Connect now requests connect", async () => {
    const user = userEvent.setup();
    const onConnectNow = vi.fn();
    render(<ConnectionCreatedDialog open onConnectNow={onConnectNow} onNotNow={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: ConnectionCopy.connectNow }));
    expect(onConnectNow).toHaveBeenCalledOnce();
  });
});
