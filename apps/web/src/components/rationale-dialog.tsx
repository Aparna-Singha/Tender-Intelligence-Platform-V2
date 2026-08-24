"use client";

import { useEffect, useState, type JSX } from "react";
import { Button, FormMessage, Modal, Textarea } from "@tender/ui";

export function RationaleDialog({
  confirmLabel,
  description,
  helperText,
  initialValue = "",
  label = "Rationale",
  maxLength = 2_000,
  minLength = 10,
  onClose,
  onConfirm,
  title,
}: {
  readonly confirmLabel: string;
  readonly description?: string;
  readonly helperText?: string;
  readonly initialValue?: string;
  readonly label?: string;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly onClose: () => void;
  readonly onConfirm: (rationale: string) => void | Promise<void>;
  readonly title: string;
}): JSX.Element {
  const [rationale, setRationale] = useState(initialValue);
  const [error, setError] = useState("");

  useEffect(() => {
    setRationale(initialValue);
    setError("");
  }, [initialValue, title]);

  async function submit(): Promise<void> {
    const trimmed = rationale.trim();
    if (trimmed.length < minLength) {
      setError(`Enter at least ${minLength} characters.`);
      return;
    }
    setError("");
    await onConfirm(trimmed);
  }

  return (
    <Modal label={title} onClose={onClose}>
      <div className="workspace-section__header">
        <div>
          <h2>{title}</h2>
          {description !== undefined && <p>{description}</p>}
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          {label}
          <Textarea
            autoFocus
            maxLength={maxLength}
            onChange={(event) => setRationale(event.target.value)}
            rows={6}
            value={rationale}
          />
        </label>
        {helperText !== undefined && <p>{helperText}</p>}
        {error !== "" && <FormMessage>{error}</FormMessage>}
        <div className="inline-actions">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button type="submit">{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
