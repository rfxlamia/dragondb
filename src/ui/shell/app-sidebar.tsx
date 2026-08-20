/**
 * The app's single navigation column: a persistent Connections block above a
 * two-way view switch. The session is context for everything below it, so it
 * stays visible in both tabs rather than becoming a third view.
 *
 * The switch is a real radio group in visually hidden inputs (the `.ui-segment`
 * pattern already used for Visual/SQL), so roving focus and arrow keys come
 * from the platform and only the OS dot is replaced.
 */
import { SidebarAccessibility } from "./sidebar-accessibility";
import { SidebarCopy } from "./sidebar-copy";

export type SidebarTab = "schema" | "queries";

export type AppSidebarProps = {
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  /** Set while a sheet or confirm owns the sidebar — switching would strand it. */
  switcherDisabled?: boolean;
  connections: React.ReactNode;
  schema: React.ReactNode;
  queries: React.ReactNode;
};

const TAB_LABELS: Record<SidebarTab, string> = {
  schema: SidebarCopy.schemaTab,
  queries: SidebarCopy.queriesTab,
};

export function AppSidebar(props: AppSidebarProps): React.JSX.Element {
  const { tab, onTabChange, switcherDisabled = false, connections, schema, queries } = props;

  return (
    <div className="app-sidebar__inner">
      {connections}

      <div
        className="ui-segment app-sidebar__switcher"
        role="tablist"
        aria-label={SidebarCopy.views}
        data-testid={SidebarAccessibility.switcher}
      >
        {(["schema", "queries"] as const).map((value) => (
          <label key={value} className="ui-segment__item">
            <input
              type="radio"
              className="ui-visually-hidden"
              id={`sidebar-tab-${value}`}
              name="app-sidebar-tab"
              value={value}
              checked={tab === value}
              disabled={switcherDisabled}
              onChange={() => onTabChange(value)}
              role="tab"
              aria-selected={tab === value}
            />
            {TAB_LABELS[value]}
          </label>
        ))}
      </div>

      <div
        className="app-sidebar__tabpanel"
        id="sidebar-tabpanel-schema"
        role="tabpanel"
        aria-labelledby="sidebar-tab-schema"
        data-testid={SidebarAccessibility.tabPanel}
        hidden={tab !== "schema"}
        inert={tab !== "schema" ? true : undefined}
      >
        {schema}
      </div>
      <div
        className="app-sidebar__tabpanel"
        id="sidebar-tabpanel-queries"
        role="tabpanel"
        aria-labelledby="sidebar-tab-queries"
        hidden={tab !== "queries"}
        inert={tab !== "queries" ? true : undefined}
      >
        {queries}
      </div>
    </div>
  );
}
