import "./Database.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pin, Calendar, Plus } from "lucide-react";
import type { Editor } from "@tiptap/react";
import RichEditor, { RichEditorHandle } from "./components/RichEditor";
import { EditorToolbar } from "./components/EditorToolbar";

// ─── Types ───────────────────────────────────────────────

interface Note {
  id: string;
  text: string;
  created_at: number;
  updated_at: number;
  pinned: boolean;
  follow_up_date?: string;
  status: string;
}

// ─── Utilities ───────────────────────────────────────────

function htmlToPlain(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function firstLine(html: string): string {
  const plain = htmlToPlain(html);
  return plain.split("\n").find((l) => l.trim()) ?? "New Note";
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Custom sort: pinned → overdue follow-ups → updatedAt desc
function sortNotes(notes: Note[]): Note[] {
  const today = todayISO();
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aDue = !!(a.follow_up_date && a.follow_up_date <= today);
    const bDue = !!(b.follow_up_date && b.follow_up_date <= today);
    if (aDue !== bDue) return aDue ? -1 : 1;
    return b.updated_at - a.updated_at;
  });
}

function isInteractiveElement(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if ((el as HTMLElement).getAttribute?.("contenteditable") === "true") return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

function smartDate(ms: number): string {
  const date = new Date(ms);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const AUTOSAVE_MS = 500;

// ─── Component ───────────────────────────────────────────

function Database() {
  const appWindow = getCurrentWindow();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  // undefined = nothing selected; null = draft; string = saved note id
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [dbEditor, setDbEditor] = useState<Editor | null>(null);
  const [dbZoom, setDbZoom] = useState(100);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<RichEditorHandle>(null);
  const editorHtmlRef = useRef<string>("");

  // Stable refs so keyboard handlers always call the current closure
  const createNoteRef = useRef<() => void>(() => {});
  const deleteNoteRef = useRef<() => void>(() => {});

  // ── Initial load ──────────────────────────────────────

  useEffect(() => {
    Promise.all([invoke<Note[]>("list_notes"), invoke<string>("load_draft")]).then(
      ([fetchedNotes, fetchedDraft]) => {
        const sorted = sortNotes(fetchedNotes);
        setNotes(sorted);
        setDraft(fetchedDraft);

        if (fetchedDraft.trim()) {
          setSelectedId(null);
          editorHtmlRef.current = fetchedDraft;
          editorRef.current?.setContent(fetchedDraft);
        } else if (sorted.length > 0) {
          setSelectedId(sorted[0].id);
          editorHtmlRef.current = sorted[0].text;
          editorRef.current?.setContent(sorted[0].text);
        } else {
          setSelectedId(undefined);
        }
      }
    );
  }, []);

  // ── Refresh on window focus ───────────────────────────

  useEffect(() => {
    const onFocus = () => {
      Promise.all([invoke<Note[]>("list_notes"), invoke<string>("load_draft")]).then(
        ([freshNotes, freshDraft]) => {
          setNotes(sortNotes(freshNotes));
          setDraft(freshDraft);
        }
      );
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────
  // Ctrl+N = new note; Delete/Backspace (when not in editor) = archive note

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        createNoteRef.current();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isInteractiveElement()) {
        e.preventDefault();
        deleteNoteRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Save / select helpers ─────────────────────────────

  const flushSave = () => {
    clearTimeout(saveTimer.current);
    const html = editorHtmlRef.current;
    if (selectedId === null) {
      invoke("save_draft", { text: html }).catch(console.error);
    } else if (typeof selectedId === "string") {
      invoke("update_note", { id: selectedId, text: html }).catch(console.error);
      setNotes((prev) =>
        prev.map((n) => n.id === selectedId ? { ...n, text: html, updated_at: Date.now() } : n)
      );
    }
  };

  const selectNote = (id: string | null) => {
    flushSave();
    setSelectedId(id);
    const content = id === null ? draft : (notes.find((n) => n.id === id)?.text ?? "");
    editorHtmlRef.current = content;
    editorRef.current?.setContent(content);
    editorRef.current?.focus();
  };

  // ── New note ──────────────────────────────────────────

  const createNewNote = async () => {
    // If a blank note already exists, just select it
    const existing = notes.find((n) => !htmlToPlain(n.text).trim());
    if (existing) {
      selectNote(existing.id);
      return;
    }
    // Also bail if the currently-selected note is already blank
    if (typeof selectedId === "string") {
      const current = notes.find((n) => n.id === selectedId);
      if (current && !htmlToPlain(current.text).trim()) {
        editorRef.current?.focus();
        return;
      }
    }

    try {
      const newNote = await invoke<Note>("create_note");
      setNotes((prev) => sortNotes([newNote, ...prev]));
      setSelectedId(newNote.id);
      editorHtmlRef.current = "";
      editorRef.current?.setContent("");
      editorRef.current?.focus();
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  };

  createNoteRef.current = createNewNote;

  // ── Delete (archive) note ─────────────────────────────

  const deleteSelectedNote = async () => {
    if (typeof selectedId !== "string") return;

    clearTimeout(saveTimer.current); // don't autosave the note we're deleting

    try {
      await invoke("archive_note", { id: selectedId });
    } catch (e) {
      console.error("Failed to archive note:", e);
      return;
    }

    const remaining = sortNotes(notes.filter((n) => n.id !== selectedId));
    setNotes(remaining);

    if (remaining.length > 0) {
      const next = remaining[0];
      setSelectedId(next.id);
      editorHtmlRef.current = next.text;
      editorRef.current?.setContent(next.text);
      editorRef.current?.focus();
    } else if (draft.trim()) {
      setSelectedId(null);
      editorHtmlRef.current = draft;
      editorRef.current?.setContent(draft);
      editorRef.current?.focus();
    } else {
      // No notes and no draft — create a fresh blank note
      setSelectedId(undefined);
      editorHtmlRef.current = "";
      editorRef.current?.setContent("");
      try {
        const newNote = await invoke<Note>("create_note");
        setNotes([newNote]);
        setSelectedId(newNote.id);
        editorRef.current?.focus();
      } catch (e) {
        console.error("Failed to create replacement note:", e);
      }
    }
  };

  deleteNoteRef.current = deleteSelectedNote;

  // ── Editor change → immediate list update + debounced save ──

  const handleEditorChange = (html: string) => {
    editorHtmlRef.current = html;

    if (selectedId === null) {
      setDraft(html);
    } else if (typeof selectedId === "string") {
      setNotes((prev) =>
        prev.map((n) => n.id === selectedId ? { ...n, text: html, updated_at: Date.now() } : n)
      );
    }

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (selectedId === null) {
        invoke("save_draft", { text: html }).catch(console.error);
      } else if (typeof selectedId === "string") {
        invoke("update_note", { id: selectedId, text: html }).catch(console.error);
      }
    }, AUTOSAVE_MS);
  };

  const handleZoomChange = (z: number) => {
    setDbZoom(z);
    editorRef.current?.setZoom(z);
  };

  // ── Filtered + sorted note list ───────────────────────

  const query = search.toLowerCase();
  const showDraft = draft.trim() && (!query || htmlToPlain(draft).toLowerCase().includes(query));
  const filteredNotes = sortNotes(
    notes.filter((n) => !query || htmlToPlain(n.text).toLowerCase().includes(query))
  );

  const editorDisabled = selectedId === undefined;

  // ── Render ────────────────────────────────────────────

  return (
    <div className="db">

      {/* ── Top nav ── */}
      <nav className="db-topnav" data-tauri-drag-region>
        <div className="db-logo" data-tauri-no-drag>
          <svg className="db-logo-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M9 1L2 9.5H7.5L7 15L14 6.5H8.5L9 1Z" fill="#7c3aed" strokeLinejoin="round" />
          </svg>
          <span className="db-logo-text">QuikCap</span>
        </div>

        <div className="db-tabs" data-tauri-no-drag>
          <button className="db-tab db-tab--active">Saved Notes</button>
          <button className="db-tab db-tab--inactive">Settings</button>
        </div>

        <div className="cap-winctrl-group" data-tauri-no-drag style={{ marginLeft: "auto" }}>
          <button className="cap-winctrl cap-winctrl--min" onClick={() => appWindow.minimize()} title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" rx="0.5" fill="currentColor" /></svg>
          </button>
          <button className="cap-winctrl cap-winctrl--max" onClick={() => appWindow.toggleMaximize()} title="Maximize">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="cap-winctrl cap-winctrl--close" onClick={() => appWindow.hide()} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </div>
      </nav>

      {/* ── Workspace ── */}
      <div className="db-workspace">

        {dbEditor && !editorDisabled && (
          <div className="db-toolbar-surface">
            <EditorToolbar editor={dbEditor} zoom={dbZoom} onZoomChange={handleZoomChange} />
          </div>
        )}

        <div className="db-main-surface">

          {/* Notes list */}
          <div className="db-list">

            {/* New Note button */}
            <div className="db-list-actions">
              <button
                className="db-new-btn"
                onClick={createNewNote}
                title="New note (Ctrl+N)"
              >
                <Plus size={13} strokeWidth={2.5} />
                New Note
              </button>
            </div>

            <div className="db-cards">

              {/* Draft (always first) */}
              {showDraft && (
                <button
                  className={`db-card db-card-draft${selectedId === null ? " db-card-selected" : ""}`}
                  onClick={() => selectNote(null)}
                >
                  <span className="db-card-title">{firstLine(draft)}</span>
                  <div className="db-card-meta">
                    <span className="db-active-dot" title="Active in Capture" />
                  </div>
                </button>
              )}

              {/* Saved notes */}
              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  className={`db-card${selectedId === note.id ? " db-card-selected" : ""}`}
                  onClick={() => selectNote(note.id)}
                >
                  <span className="db-card-title">{firstLine(note.text)}</span>
                  <div className="db-card-meta">
                    {note.pinned && <Pin size={10} strokeWidth={2.5} className="db-icon-pin" />}
                    {note.follow_up_date && <Calendar size={10} strokeWidth={2.5} className="db-icon-cal" />}
                    <span className="db-card-date">{smartDate(note.updated_at)}</span>
                  </div>
                </button>
              ))}

              {!showDraft && filteredNotes.length === 0 && (
                <div className="db-empty">
                  {search ? "No notes match." : "No saved notes yet."}
                </div>
              )}
            </div>
          </div>

          {/* Editor panel */}
          <div className="db-editor-panel">

            <div className="db-editor-header">
              <input
                className="db-search"
                type="text"
                placeholder="Search notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <RichEditor
              ref={editorRef}
              onChange={handleEditorChange}
              disabled={editorDisabled}
              hideToolbar={true}
              onEditorReady={(e) => setDbEditor(e)}
              onZoomChange={(z) => setDbZoom(z)}
            />
          </div>

        </div>
      </div>
    </div>
  );
}

export default Database;
