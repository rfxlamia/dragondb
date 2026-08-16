import { TabBarAccessibility } from "./tab-bar-accessibility";
import { TabBarCopy } from "./tab-bar-copy";
import "./tab-bar.css";

export type TabBarItem = {
  id: string;
  title: string;
  isActive: boolean;
  pendingClose?: boolean;
};

export type TabBarProps = {
  tabs: TabBarItem[];
  onNewTab: () => void;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
};

export function TabBar(props: TabBarProps): React.JSX.Element {
  const { tabs, onNewTab, onSwitchTab, onCloseTab } = props;
  const showStrip = tabs.length >= 2;
  const soloTab = tabs.length === 1 ? tabs[0] : undefined;

  return (
    <div className="tab-bar">
      {showStrip ? (
        <div className="tab-bar__strip" data-testid={TabBarAccessibility.strip} role="tablist">
          {tabs.map((tab) => (
            <div className="tab-bar__item" key={tab.id} role="presentation">
              <button
                type="button"
                role="tab"
                className={tab.isActive ? "tab-bar__tab tab-bar__tab--active" : "tab-bar__tab"}
                aria-selected={tab.isActive}
                onClick={() => {
                  if (tab.pendingClose) return;
                  onSwitchTab(tab.id);
                }}
              >
                {tab.pendingClose ? TabBarCopy.closing : tab.title}
              </button>
              <button
                type="button"
                className="tab-bar__close"
                aria-label={TabBarCopy.closeTab}
                onClick={() => onCloseTab(tab.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {soloTab !== undefined ? (
        <div className="tab-bar__item tab-bar__item--solo">
          <span className="tab-bar__tab tab-bar__tab--active tab-bar__tab--solo">
            {soloTab.title}
          </span>
          <button
            type="button"
            className="tab-bar__close"
            data-testid={TabBarAccessibility.closeTab}
            aria-label={TabBarCopy.closeTab}
            onClick={() => onCloseTab(soloTab.id)}
          >
            ×
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="tab-bar__new"
        data-testid={TabBarAccessibility.newTab}
        aria-label={TabBarCopy.newTab}
        onClick={onNewTab}
      >
        +
      </button>
    </div>
  );
}
