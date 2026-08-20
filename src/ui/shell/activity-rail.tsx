/**
 * Permanent icon rail on the shell's left edge. It is a real grid track, not a
 * layer that appears when the panel collapses — collapsing now animates the
 * panel to zero width and leaves the rail exactly where it already was.
 *
 * The rail owns the only sidebar toggle in the app: a panel-header copy would
 * vanish with the panel it collapses, and two toggles for one state is the
 * duplication the brief forbids for session actions.
 */
import { ConnectionAccessibility } from "../connection/connection-accessibility";
import { ConnectionCopy } from "../connection/connection-copy";
import { HelpCopy } from "../help/help-copy";
import { HelpIcon, SettingsIcon, SidebarIcon } from "../icons";
import "./activity-rail.css";

export type ActivityRailProps = {
  collapsed: boolean;
  /** Set while a sheet or confirm owns the sidebar — see AppSidebar. */
  toggleDisabled?: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
};

export function ActivityRail(props: ActivityRailProps): React.JSX.Element {
  const { collapsed, toggleDisabled = false, onToggle, onOpenSettings, onOpenHelp } = props;
  const toggleLabel = collapsed ? ConnectionCopy.showConnection : ConnectionCopy.collapseConnection;

  return (
    <div className="activity-rail">
      <button
        type="button"
        className="ui-icon-btn"
        data-testid={ConnectionAccessibility.collapseConnection}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={!collapsed}
        disabled={toggleDisabled}
        onClick={onToggle}
      >
        <SidebarIcon />
      </button>

      <div className="activity-rail__spacer" />

      <button
        type="button"
        className="ui-icon-btn"
        aria-label={HelpCopy.openSettings}
        title={HelpCopy.openSettings}
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </button>
      <button
        type="button"
        className="ui-icon-btn"
        aria-label={HelpCopy.openHelp}
        title={HelpCopy.openHelp}
        onClick={onOpenHelp}
      >
        <HelpIcon />
      </button>
    </div>
  );
}
