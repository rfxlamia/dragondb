import { useEffect, useState } from "react";
import {
  loadDateFormat,
  type QueryResultsDateFormat,
  saveDateFormat,
} from "../../lib/date-format-setting";
import { HelpCopy } from "./help-copy";
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
    <div className="help-dialog" role="dialog" aria-label={HelpCopy.settingsTitle}>
      <h2 className="help-dialog__title">{HelpCopy.settingsTitle}</h2>
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
      <div className="help-dialog__actions">
        <button type="button" className="help-dialog__done" onClick={() => onOpenChange(false)}>
          {HelpCopy.done}
        </button>
      </div>
    </div>
  );
}
