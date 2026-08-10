// Chip-row picker for a notification sound, with an optional "inherit" chip
// (undefined value) so per-account / per-room pickers can fall back to the
// broader default. Picking a sound previews it.

import { SOUND_OPTIONS, playSound, type SoundId } from "../sounds";

export function SoundPicker({
  label,
  value,
  inheritLabel,
  onChange,
}: {
  label: string;
  /** Explicit choice; undefined = inherit (shown only when inheritLabel is given). */
  value: SoundId | undefined;
  inheritLabel?: string;
  onChange: (id: SoundId | undefined) => void;
}) {
  return (
    <div className="theme-picker" role="radiogroup" aria-label={label} style={{ flexWrap: "wrap" }}>
      {inheritLabel && (
        <button
          role="radio"
          aria-checked={value === undefined}
          className={`chip${value === undefined ? " selected" : ""}`}
          onClick={() => onChange(undefined)}
        >
          {inheritLabel}
        </button>
      )}
      {SOUND_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          role="radio"
          aria-checked={value === opt.id}
          className={`chip${value === opt.id ? " selected" : ""}`}
          onClick={() => {
            onChange(opt.id);
            playSound(opt.id); // preview on pick
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
