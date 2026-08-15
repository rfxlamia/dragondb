import type { ConnectionProfileDto } from "../../ipc/contract";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionProfileList(props: {
  profiles: ConnectionProfileDto[];
  formVisible: boolean;
  onSelect: (profile: ConnectionProfileDto) => void;
  onNewProfile: () => void;
}): React.JSX.Element {
  const { profiles, formVisible, onSelect, onNewProfile } = props;
  return (
    <div className="connection-panel__profiles">
      <div className="connection-panel__profiles-header">
        <h3>{ConnectionCopy.profilesHeading}</h3>
        <button type="button" className="connection-panel__new" onClick={onNewProfile}>
          {ConnectionCopy.newProfile}
        </button>
      </div>
      {profiles.length === 0 && formVisible ? (
        <p className="connection-panel__hint" data-testid={ConnectionAccessibility.noConnections}>
          {ConnectionCopy.noConnections}
        </p>
      ) : (
        <ul>
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button type="button" onClick={() => onSelect(profile)}>
                {profileLabel(profile)}
              </button>
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
