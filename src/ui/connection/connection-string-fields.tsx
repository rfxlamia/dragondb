import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy } from "./connection-copy";

export function ConnectionStringFields(props: {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  errorMessage: string | null;
  onCopy: () => void;
}): React.JSX.Element {
  const { value, onChange, readOnly, errorMessage, onCopy } = props;
  return (
    <div className="connection-string-fields">
      <textarea
        data-testid={ConnectionAccessibility.connectionStringField}
        value={value}
        readOnly={readOnly}
        rows={3}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={onCopy}>
        {ConnectionCopy.copyConnectionString}
      </button>
      {errorMessage ? <p className="connection-panel__status">{errorMessage}</p> : null}
    </div>
  );
}
