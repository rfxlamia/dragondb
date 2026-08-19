import { useEffect, useState } from "react";
import {
  loadDateFormat,
  type QueryResultsDateFormat,
  saveDateFormat,
} from "../../lib/date-format-setting";
import { HelpAccessibility } from "./help-accessibility";
import { HelpCopy } from "./help-copy";
import { HelpDialogShell } from "./help-dialog-shell";
import "./help.css";

export type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DATE_FORMAT_RADIOS: ReadonlyArray<{ value: QueryResultsDateFormat; label: string }> = [
  { value: "iso8601", label: HelpCopy.dateFormatIso },
  { value: "iso8601DateOnly", label: HelpCopy.dateFormatIsoDateOnly },
  { value: "us", label: HelpCopy.dateFormatUs },
  { value: "european", label: HelpCopy.dateFormatEuropean },
  { value: "relative", label: HelpCopy.dateFormatRelative },
];

export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element | null {
  const { open, onOpenChange } = props;
  const [format, setFormat] = useState<QueryResultsDateFormat>(loadDateFormat);

  useEffect(() => {
    if (open) setFormat(loadDateFormat());
  }, [open]);

  if (!open) return null;

  function selectFormat(value: QueryResultsDateFormat): void {
    saveDateFormat(value);
    setFormat(value);
  }

  return (
    <HelpDialogShell
      title={HelpCopy.settingsTitle}
      doneTestId={HelpAccessibility.settingsDone}
      onDone={() => onOpenChange(false)}
    >
      <div className="help-dialog__radios" role="radiogroup" aria-label={HelpCopy.settingsTitle}>
        {DATE_FORMAT_RADIOS.map((option) => (
          <label key={option.value} className="help-dialog__radio">
            <input
              type="radio"
              name="query-results-date-format"
              value={option.value}
              checked={format === option.value}
              onChange={() => selectFormat(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </HelpDialogShell>
  );
}
