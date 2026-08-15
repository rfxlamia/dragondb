import { useState } from "react";
import type { ProfileId } from "../../ipc/contract";
import { parseConnectionString } from "../../lib/connection-string";
import type { ConnectionFormValue } from "./connection-form";
import { copyUriForProfile, profileFromParsedUri } from "./connection-uri";

/** URI-mode state for the connection panel. Parse happens on Save only. */
export function useConnectionStringMode(): {
  connectionStringMode: boolean;
  setConnectionStringMode: (next: boolean) => void;
  setConnectionStringDraft: (next: string) => void;
  resetUriMode: () => void;
  uriValue: (selectedId: ProfileId | null, form: ConnectionFormValue) => string;
  copy: (selectedId: ProfileId | null, form: ConnectionFormValue) => Promise<void>;
  applyParseOnSave: (
    form: ConnectionFormValue,
    selectedId: ProfileId | null,
  ) => ConnectionFormValue;
} {
  const [connectionStringMode, setConnectionStringMode] = useState(false);
  const [connectionStringDraft, setConnectionStringDraft] = useState("");

  function resetUriMode(): void {
    setConnectionStringMode(false);
    setConnectionStringDraft("");
  }

  function uriValue(selectedId: ProfileId | null, form: ConnectionFormValue): string {
    return selectedId !== null ? copyUriForProfile(form.profile) : connectionStringDraft;
  }

  async function copy(selectedId: ProfileId | null, form: ConnectionFormValue): Promise<void> {
    try {
      await navigator.clipboard.writeText(uriValue(selectedId, form));
    } catch {
      // Keep the Copy label and leave the form open.
    }
  }

  function applyParseOnSave(
    form: ConnectionFormValue,
    selectedId: ProfileId | null,
  ): ConnectionFormValue {
    if (!connectionStringMode || selectedId !== null) {
      return form;
    }
    const parsed = parseConnectionString(connectionStringDraft);
    return {
      profile: profileFromParsedUri(form.profile, parsed),
      secrets: {
        ...form.secrets,
        ...(parsed.password !== undefined ? { password: parsed.password } : {}),
      },
    };
  }

  return {
    connectionStringMode,
    setConnectionStringMode,
    setConnectionStringDraft,
    resetUriMode,
    uriValue,
    copy,
    applyParseOnSave,
  };
}
