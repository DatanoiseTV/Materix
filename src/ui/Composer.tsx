// Message composer: auto-growing textarea, Enter to send, Shift+Enter newline,
// markdown support, attachments (button, paste, drop), reply/edit modes,
// typing notifications.

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { RoomHandle } from "../core/roomHandle";
import type { TimelineItem } from "../core/types";
import { IconPaperclip, IconSend, IconX, IconEdit, IconReply } from "./components/Icons";
import { useToast } from "./components/Toast";

export interface ComposeMode {
  kind: "reply" | "edit";
  item: TimelineItem;
}

export function Composer({
  handle,
  mode,
  onClearMode,
}: {
  handle: RoomHandle;
  mode: ComposeMode | null;
  onClearMode: () => void;
}) {
  const [text, setText] = useState("");
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef<{ active: boolean; timer?: ReturnType<typeof setTimeout> }>({ active: false });
  const { showError } = useToast();

  // Drafts per room; edit mode preloads the original text.
  useEffect(() => {
    setText(mode?.kind === "edit" ? (mode.item.body?.msgtype === "m.text" ? mode.item.body.text : "") : "");
    taRef.current?.focus();
  }, [mode, handle.roomId]);

  useEffect(() => {
    taRef.current?.focus();
    setText("");
    onClearMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle.roomId]);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`;
  };

  const setTyping = (active: boolean) => {
    const t = typingRef.current;
    if (t.timer) clearTimeout(t.timer);
    if (active) {
      if (!t.active) {
        t.active = true;
        void handle.setTyping(true);
      }
      t.timer = setTimeout(() => {
        t.active = false;
        void handle.setTyping(false);
      }, 8000);
    } else if (t.active) {
      t.active = false;
      void handle.setTyping(false);
    }
  };

  async function send() {
    const value = text.trim();
    if (!value) return;
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
    setTyping(false);
    const currentMode = mode;
    onClearMode();
    try {
      if (currentMode?.kind === "edit" && currentMode.item.eventId) {
        await handle.edit(currentMode.item.eventId, value);
      } else {
        await handle.sendText(value, currentMode?.kind === "reply" ? currentMode.item.eventId : undefined);
      }
    } catch (e) {
      showError(e);
      setText(value); // don't lose the user's message
    }
  }

  async function sendFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      setUpload({ name: file.name, pct: 0 });
      try {
        await handle.sendFile(file, (loaded, total) =>
          setUpload({ name: file.name, pct: total ? Math.round((loaded / total) * 100) : 0 }),
        );
      } catch (e) {
        showError(e);
      } finally {
        setUpload(null);
      }
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.items]
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void sendFiles(files);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void sendFiles(e.dataTransfer.files);
  };

  return (
    <div className="composer-wrap" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="composer">
        {mode && (
          <div className="composer-reply">
            {mode.kind === "reply" ? <IconReply size={14} /> : <IconEdit size={14} />}
            <span className="composer-reply-text">
              {mode.kind === "reply" ? (
                <>
                  Replying to <strong>{mode.item.sender.name}</strong>: {mode.item.body?.text?.slice(0, 80)}
                </>
              ) : (
                "Editing message"
              )}
            </span>
            <button className="icon-btn" onClick={onClearMode} aria-label="Cancel" style={{ width: 26, height: 26 }}>
              <IconX size={14} />
            </button>
          </div>
        )}
        <div className="composer-main">
          <button
            className="icon-btn"
            onClick={() => fileRef.current?.click()}
            title="Attach file"
            aria-label="Attach file"
            disabled={!!upload}
          >
            <IconPaperclip size={19} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void sendFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Message"
            value={text}
            aria-label="Message"
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
              setTyping(!!e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape" && mode) onClearMode();
            }}
            onPaste={onPaste}
          />
          <button className="send-btn" onClick={() => void send()} disabled={!text.trim()} aria-label="Send message">
            <IconSend size={18} />
          </button>
        </div>
        {upload && (
          <div className="upload-progress">
            Uploading {upload.name}… {upload.pct}%
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${upload.pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
