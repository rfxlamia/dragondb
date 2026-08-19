import type { ConnectionProfileDto, ProfileId } from "../../ipc/contract";
import { PlusIcon, ServerIcon, TrashIcon } from "../icons";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionProfileList(props: {
  profiles: ConnectionProfileDto[];
  formVisible: boolean;
  onSelect: (profile: ConnectionProfileDto) => void;
  onNewProfile: () => void;
  /** Profile backing the live session (or the current edit target). */
  activeId?: ProfileId | null;
  /** When true, the parent renders the section header and new-profile control. */
  hideHeader?: boolean;
  /**
   * Row-level delete is offered only while the connection sheet is closed —
   * the sheet's footer owns Delete when it is open, so exactly one Delete
   * control exists at any time.
   */
  onRequestDelete?: (profile: ConnectionProfileDto) => void;
}): React.JSX.Element {
  const {
    profiles,
    formVisible,
    onSelect,
    onNewProfile,
    activeId = null,
    onRequestDelete,
    hideHeader = false,
  } = props;
  const rowActions = onRequestDelete !== undefined && !formVisible;
  return (
    <div className="connection-panel__profiles">
      {hideHeader ? null : (
        <div className="connection-panel__profiles-header">
          <h3>{ConnectionCopy.profilesHeading}</h3>
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--accent"
            aria-label={ConnectionCopy.newProfile}
            title={ConnectionCopy.newProfile}
            onClick={onNewProfile}
          >
            <PlusIcon />
          </button>
        </div>
      )}
      {profiles.length === 0 && formVisible ? (
        <p className="connection-panel__hint" data-testid={ConnectionAccessibility.noConnections}>
          {ConnectionCopy.noConnections}
        </p>
      ) : (
        <ul>
          {profiles.map((profile) => (
            <li key={profile.id} className="connection-panel__profile ui-row-host">
              <button
                type="button"
                className={profile.id === activeId ? "ui-row ui-row--selected" : "ui-row"}
                onClick={() => onSelect(profile)}
              >
                <span className="ui-row__glyph">
                  <ServerIcon size={14} />
                </span>
                <span className="ui-row__label">{profileLabel(profile)}</span>
              </button>
              {rowActions ? (
                <div className="ui-row-actions connection-panel__profile-actions">
                  <button
                    type="button"
                    className="ui-icon-btn ui-icon-btn--danger"
                    aria-label={ConnectionCopy.delete}
                    title={ConnectionCopy.delete}
                    onClick={() => onRequestDelete?.(profile)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function profileLabel(profile: ConnectionProfileDto): string {
  return profile.name?.trim() || profile.host || ConnectionCopy.unnamedProfile;
}
