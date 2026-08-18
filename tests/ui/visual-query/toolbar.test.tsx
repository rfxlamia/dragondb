/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";
import { VisualQueryToolbar } from "../../../src/ui/visual-query/toolbar";

afterEach(() => {
  cleanup();
});

describe("VisualQueryToolbar", () => {
  it("hides Start over when canStartOver is false", () => {
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
      />,
    );
    expect(screen.queryByTestId(VisualQueryAccessibility.startOver)).not.toBeInTheDocument();
  });

  it("calls onStartOver when Start over is clicked", async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={onStartOver}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: VisualQueryCopy.startOverTitle }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });
});

describe("VisualQueryToolbar Run control (SP-2)", () => {
  it("disables or hides Run when disconnected", () => {
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={false}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
      />,
    );
    const run = screen.queryByTestId(VisualQueryAccessibility.runQuery);
    if (run) {
      expect(run).toBeDisabled();
    } else {
      expect(screen.queryByRole("button", { name: VisualQueryCopy.runQueryTitle })).toBeNull();
    }
  });

  it("enables Run when connected and runnable with a11y id + copy title", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={true}
        onRunQuery={onRunQuery}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
      />,
    );
    const run = screen.getByTestId(VisualQueryAccessibility.runQuery);
    expect(run).toHaveAttribute("data-testid", VisualQueryAccessibility.runQuery);
    expect(run).toHaveAccessibleName(VisualQueryCopy.runQueryTitle);
    expect(run).not.toBeDisabled();
    await user.click(run);
    expect(onRunQuery).toHaveBeenCalledOnce();
  });
});

describe("VisualQueryToolbar View generated SQL (SP-4b)", () => {
  it("renders View generated SQL with a11y id and copy title", async () => {
    const user = userEvent.setup();
    const onViewGeneratedSQL = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={true}
        onRunQuery={() => {}}
        onViewGeneratedSQL={onViewGeneratedSQL}
        runHelpMessage={null}
      />,
    );
    const button = screen.getByTestId(VisualQueryAccessibility.viewGeneratedSQL);
    expect(button).toHaveAccessibleName(VisualQueryCopy.viewGeneratedSQLTitle);
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onViewGeneratedSQL).toHaveBeenCalledOnce();
  });

  it("disables View generated SQL when disconnected", () => {
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={false}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
      />,
    );
    expect(screen.getByTestId(VisualQueryAccessibility.viewGeneratedSQL)).toBeDisabled();
  });

  it("shows runHelpMessage when Run is disabled for incomplete SELECT", () => {
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage="Choose a table in FROM"
      />,
    );
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    expect(screen.getByText("Choose a table in FROM")).toBeInTheDocument();
  });
});

describe("VisualQueryToolbar History (SP-4b)", () => {
  it("shows History and click calls onHistory", async () => {
    const user = userEvent.setup();
    const onHistory = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
        onHistory={onHistory}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.history));
    expect(onHistory).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: VisualQueryCopy.historyTitle })).toBeInTheDocument();
  });

  it("hides History when onHistory is omitted", () => {
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
      />,
    );
    expect(screen.queryByTestId(VisualQueryAccessibility.history)).not.toBeInTheDocument();
  });
});

describe("VisualQueryToolbar Visual | SQL (SP-4b T9)", () => {
  it("Visual | SQL segmented toggle defaults to Visual and reports SQL", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={true}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
        editorMode="visual"
        onEditorModeChange={onModeChange}
      />,
    );
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    expect(onModeChange).toHaveBeenCalledWith("sql");
  });

  // The segmented control is a styled <label> over a visually hidden native
  // radio precisely so the browser keeps roving focus and arrow keys. If it
  // ever regresses to buttons with aria-checked, this is what breaks.
  it("moves the editor mode with arrow keys, not just clicks", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={true}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
        editorMode="visual"
        onEditorModeChange={onModeChange}
      />,
    );

    const visual = screen.getByRole("radio", { name: /visual/i });
    expect(visual).toBeChecked();

    visual.focus();
    await user.keyboard("{ArrowRight}");
    expect(onModeChange).toHaveBeenCalledWith("sql");
  });

  it("marks exactly one editor mode checked", () => {
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={true}
        onRunQuery={() => {}}
        onViewGeneratedSQL={() => {}}
        runHelpMessage={null}
        editorMode="sql"
        onEditorModeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: /sql/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /visual/i })).not.toBeChecked();
  });
});
