// Compact emoji picker popover: searchable, keyboard-friendly, no deps.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const EMOJI: [string, string][] = [
  ["👍", "thumbs up"], ["👎", "thumbs down"], ["❤️", "heart"], ["🧡", "orange heart"],
  ["💜", "purple heart"], ["💯", "hundred"], ["🔥", "fire"], ["✨", "sparkles"],
  ["🎉", "party"], ["🥳", "celebrate"], ["😀", "grinning"], ["😄", "smile"],
  ["😂", "joy laugh"], ["🤣", "rofl"], ["🙂", "slight smile"], ["😉", "wink"],
  ["😊", "blush"], ["😍", "heart eyes"], ["😘", "kiss"], ["😎", "cool sunglasses"],
  ["🤔", "thinking"], ["🤨", "raised eyebrow"], ["😐", "neutral"],
  ["🙄", "eye roll"], ["😴", "sleep"], ["🤯", "mind blown"], ["😮", "wow open mouth"],
  ["😢", "cry sad"], ["😭", "sob"], ["😤", "frustrated"], ["😡", "angry"],
  ["🥺", "pleading"], ["😅", "sweat smile"], ["🫠", "melting"], ["🙃", "upside down"],
  ["🤗", "hug"], ["🤫", "shush"], ["🤝", "handshake"], ["🙏", "please thanks pray"],
  ["👏", "clap"], ["🙌", "raised hands"], ["💪", "muscle strong"], ["👌", "ok"],
  ["✌️", "victory peace"], ["🤞", "fingers crossed"], ["👋", "wave hello bye"], ["🤙", "call me"],
  ["👀", "eyes look"], ["🧠", "brain"], ["🍀", "luck clover"], ["🌟", "star"],
  ["⚡", "lightning zap"], ["☀️", "sun"], ["🌙", "moon"], ["🌈", "rainbow"],
  ["🍕", "pizza"], ["🍔", "burger"], ["🍺", "beer"], ["☕", "coffee"],
  ["🎂", "cake birthday"], ["🍿", "popcorn"], ["🚀", "rocket ship"], ["✅", "check yes done"],
  ["❌", "cross no"], ["❓", "question"], ["❗", "exclamation"], ["💡", "idea bulb"],
  ["🐛", "bug"], ["🔧", "wrench fix"], ["📌", "pin"], ["🎯", "target dart"],
  ["🏆", "trophy win"], ["🥇", "gold medal"], ["🎵", "music note"], ["🎮", "game"],
  ["🐱", "cat"], ["🐶", "dog"], ["🦄", "unicorn"], ["🐢", "turtle"],
];
const EMOJIS = EMOJI.filter(([, name]) => name);

export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: { x: number; y: number };
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(anchor);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - r.height - 8)),
    });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const list = q ? EMOJIS.filter(([, name]) => name.includes(q)) : EMOJIS;

  // Keep Tab within the popover so keyboard focus can't wander behind it.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const el = ref.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>("input, button")].filter((f) => !f.hasAttribute("disabled"));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="emoji-picker"
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-modal="true"
      aria-label="Pick emoji"
      onKeyDown={onKeyDown}
    >
      <input
        autoFocus
        placeholder="Search emoji"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search emoji"
      />
      <div className="emoji-grid">
        {list.map(([emoji, name]) => (
          <button
            key={emoji}
            title={name}
            aria-label={name}
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
        {list.length === 0 && <span className="field-hint">No match</span>}
      </div>
    </div>
  );
}
