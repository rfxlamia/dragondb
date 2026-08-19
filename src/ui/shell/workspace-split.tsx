import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ResultsAccessibility } from "../results/results-accessibility";

export function WorkspaceSplit(props: {
  canvas: ReactNode;
  results: ReactNode;
}): React.JSX.Element {
  return (
    <Group orientation="vertical" className="workspace-split">
      <Panel
        className="workspace-split__canvas"
        minSize={250}
        defaultSize="60"
        data-min-canvas="250"
      >
        {props.canvas}
      </Panel>
      <Separator className="workspace-split__separator" id={ResultsAccessibility.splitSeparator} />
      <Panel className="workspace-split__results" minSize={300} data-min-results="300">
        {props.results}
      </Panel>
    </Group>
  );
}
