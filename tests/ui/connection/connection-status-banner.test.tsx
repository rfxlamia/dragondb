/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionStatusBanner } from "../../../src/ui/connection/connection-status-banner";

afterEach(() => cleanup());

describe("ConnectionStatusBanner", () => {
  it("success copy does not imply a live session", () => {
    render(<ConnectionStatusBanner phase="success" isConnected={false} />);
    expect(screen.getByText(ConnectionCopy.testSuccess)).toBeInTheDocument();
    expect(screen.queryByText(ConnectionCopy.connected)).toBeNull();
  });

  it("error phase shows the probe error while isConnected can stay true", () => {
    render(<ConnectionStatusBanner phase="error" isConnected={true} message="probe failed" />);
    expect(screen.getByText("probe failed")).toBeInTheDocument();
  });
});
