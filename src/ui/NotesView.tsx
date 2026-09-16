// Notes app surface for the personal "My Notes" room. Replaces the chat
// timeline/composer entirely: notes are a vertical list of cards (each note is
// still a Matrix message underneath), composed/edited with a markdown editor
// that has a live preview, with media attachments. No conversation framing.

import { useMemo, useRef, useState } from "react";
import type { MatrixAccount } from "../core/account";
import type { RoomHandle } from "../core/roomHandle";
import type { TimelineItem } from "../core/types";
import { markdownToMatrixHtml, sanitizeIncomingHtml, escapeHtml } from "../core/markdown";
import { useRoomVersion } from "./hooks";
import { MessageBubble, Lightbox } from "./Timeline";
import { ContextMenu, type MenuState } from "./components/ContextMenu";
import { useToast } from "./components/Toast";
import { useConfirm } from "./components/Confirm";
import { copyText } from "./clipboard";
import { formatListTime } from "./format";
import { IconCopy, IconEdit, IconPaperclip, IconPin, IconPlus, IconTrash, IconX } from "./components/Icons";

export function NotesView({ account, handle }: { account: MatrixAccount; handle: RoomHandle }) {
  useRoomVersion(account, handle.roomId);
  const items = handle.timeline();
  // Every note is a message event; newest first, like a notes app.
  const notes = useMemo(
    () => items.filter((i) => i.kind === "message" && !!i.eventId).reverse(),
    [items],
  );

  const [editing, setEditing] = useState<{ eventId?: string; text: string } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { show, showError } = useToast();
  const confirm = useConfirm();

  const save = async (text: string) => {
    const value = text.trim();
    if (!value) return;
    try {
      if (editing?.eventId) await handle.edit(editing.eventId, value);
      else await handle.sendText(value);
      setEditing(null);
    } catch (e) {
      showError(e);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await handle.sendFile(file);
      } catch (e) {
        showError(e);
      }
    }
  };

  const openCardMenu = (e: React.MouseEvent, note: TimelineItem) => {
    e.preventDefault();
    const eventId = note.eventId!;
    const isText = note.body?.msgtype === "m.text" || note.body?.msgtype === "m.notice";
    const pinned = handle.isPinned(eventId);
    const menuItems = [];
    if (isText)
      menuItems.push({
        label: "Edit",
        icon: <IconEdit size={16} />,
        onClick: () => setEditing({ eventId, text: note.body?.text ?? "" }),
      });
    if (note.body?.text)
      menuItems.push({
        label: "Copy text",
        icon: <IconCopy size={16} />,
        onClick: () => copyText(note.body!.text ?? "", account.key).then(() => show("Copied."), showError),
      });
    if (handle.canPin())
      menuItems.push({
        label: pinned ? "Unpin" : "Pin",
        icon: <IconPin size={16} />,
        onClick: () => (pinned ? handle.unpin(eventId) : handle.pin(eventId)).catch(showError),
      });
    menuItems.push({
      label: "Delete",
      icon: <IconTrash size={16} />,
      danger: true,
      onClick: () => {
        confirm({ title: "Delete this note?", danger: true, confirmLabel: "Delete" }).then((ok) => {
          if (ok) handle.redact(eventId).catch(showError);
        });
      },
    });
    setMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  };

  return (
    <div className="notes-view">
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {editing ? (
        <NoteEditor
          key={editing.eventId ?? "new"}
          initial={editing.text}
          editing={!!editing.eventId}
          onCancel={() => setEditing(null)}
          onSave={save}
          onAttach={() => fileRef.current?.click()}
        />
      ) : (
        <div className="notes-toolbar">
          <button className="btn primary notes-new" onClick={() => setEditing({ text: "" })}>
            <IconPlus size={16} /> New note
          </button>
          <button className="btn secondary" onClick={() => fileRef.current?.click()} title="Attach a file">
            <IconPaperclip size={16} /> Attach
          </button>
        </div>
      )}

      <div className="notes-list">
        {notes.length === 0 && !editing && (
          <div className="empty-state notes-empty">
            <div className="empty-glyph">
              <IconEdit size={30} />
            </div>
            <h2>Your personal space</h2>
            <p>Jot down notes, save links, or keep files for yourself. Only you can read them.</p>
          </div>
        )}
        {notes.map((note) => {
          const editable = note.body?.msgtype === "m.text" || note.body?.msgtype === "m.notice";
          return (
          <article className="note-card" key={note.eventId}>
            <div
              className={`note-card-body${editable ? " editable" : ""}`}
              // Tap a text note to edit it (notes-app style); links, buttons and
              // media controls inside still do their own thing.
              onClick={
                editable
                  ? (e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest("a, button, audio, video, input, [role=button]")) return;
                      setEditing({ eventId: note.eventId!, text: note.body?.text ?? "" });
                    }
                  : undefined
              }
            >
              <MessageBubble item={note} account={account} onZoom={setLightbox} />
            </div>
            <div className="note-card-foot">
              <span className="note-card-time">
                {formatListTime(note.ts)}
                {note.edited ? " · edited" : ""}
              </span>
              <button
                className="icon-btn note-card-menu"
                onClick={(e) => openCardMenu(e, note)}
                aria-label="Note actions"
                aria-haspopup="menu"
              >
                <span aria-hidden="true">⋯</span>
              </button>
            </div>
          </article>
          );
        })}
        {handle.canPaginateBack() && (
          <button className="btn secondary notes-load-older" onClick={() => handle.paginateBack().catch(() => undefined)}>
            Load older notes
          </button>
        )}
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function NoteEditor({
  initial,
  editing,
  onSave,
  onCancel,
  onAttach,
}: {
  initial: string;
  editing: boolean;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
  onAttach: () => void;
}) {
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const html = useMemo(() => {
    if (!preview) return "";
    const t = text.trim();
    if (!t) return "<p class='note-preview-empty'>Nothing to preview yet.</p>";
    return sanitizeIncomingHtml(markdownToMatrixHtml(t) ?? `<p>${escapeHtml(t).replace(/\n/g, "<br>")}</p>`);
  }, [preview, text]);

  return (
    <div className="note-editor">
      <div className="note-editor-head">
        <div className="note-editor-tabs" role="tablist" aria-label="Editor mode">
          <button role="tab" aria-selected={!preview} className={!preview ? "active" : ""} onClick={() => setPreview(false)}>
            Write
          </button>
          <button role="tab" aria-selected={preview} className={preview ? "active" : ""} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel">
          <IconX size={18} />
        </button>
      </div>
      {preview ? (
        <div className="note-preview" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <textarea
          className="note-editor-text"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note… markdown supported (**bold**, - lists, # headings)"
        />
      )}
      <div className="note-editor-actions">
        <button className="btn secondary" onClick={onAttach} title="Attach a file">
          <IconPaperclip size={16} /> Attach
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(text);
            } finally {
              setBusy(false);
            }
          }}
        >
          {editing ? "Save" : "Add note"}
        </button>
      </div>
    </div>
  );
}
