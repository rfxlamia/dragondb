import { accelGlyphs } from "../shell/workspace-accelerators";
import { HelpCopy } from "./help-copy";

export function ShortcutRows(props: { platform: string }): React.JSX.Element {
  const glyphs = accelGlyphs(props.platform);
  return (
    <table className="help-dialog__shortcuts">
      <tbody>
        <tr>
          <td>{HelpCopy.newTab}</td>
          <td>{glyphs.newTab}</td>
        </tr>
        <tr>
          <td>{HelpCopy.closeTab}</td>
          <td>{glyphs.closeTab}</td>
        </tr>
        <tr>
          <td>{HelpCopy.runQuery}</td>
          <td>{glyphs.runQuery}</td>
        </tr>
      </tbody>
    </table>
  );
}
