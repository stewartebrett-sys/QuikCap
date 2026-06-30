import "./Database.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pin, Calendar } from "lucide-react";
import RichEditor, { RichEditorHandle } from "./components/RichEditor";

interface Note {
  id: string;
  text: string;
  created_at: number;
  updated_at: number;
  pinned: boolean;
  follow_up_date?: string;
  status: string;
}

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
  return plain.split("\n").find((l) => l.trim()) ?? "Untitled";
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
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const AUTOSAVE_MS = 500;

function Database() {
  const appWindow = getCurrentWindow();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  // undefined = nothing selected; null = draft selected; string = saved note id
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<RichEditorHandle>(null);
  // Track what's in the editor so we can flush before switching
  const editorHtmlRef = useRef<string>("");

  // Initial load
  useEffect(() => {
    Promise.all([invoke<Note[]>("list_notes"), invoke<string>("load_draft")]).then(
      ([fetchedNotes, fetchedDraft]) => {
        setNotes(fetchedNotes);
        setDraft(fetchedDraft);

        if (fetchedDraft.trim()) {
          setSelectedId(null);
          editorHtmlRef.current = fetchedDraft;
          editorRef.current?.setContent(fetchedDraft);
        } else if (fetchedNotes.length > 0) {
          setSelectedId(fetchedNotes[0].id);
          editorHtmlRef.current = fetchedNotes[0].text;
          editorRef.current?.setContent(fetchedNotes[0].text);
        } else {
          setSelectedId(undefined);
        }
      }
    );
  }, []);

  // Refresh when window regains focus
  useEffect(() => {
    const onFocus = () => {
      Promise.all([invoke<Note[]>("list_notes"), invoke<string>("load_draft")]).then(
        ([freshNotes, freshDraft]) => {
          setNotes(freshNotes);
          setDraft(freshDraft);
        }
      );
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const flushSave = () => {
    clearTimeout(saveTimer.current);
    const html = editorHtmlRef.current;
    if (selectedId === null) {
      invoke("save_draft", { text: html }).catch(console.error);
    } else if (typeof selectedId === "string") {
      invoke("update_note", { id: selectedId, text: html }).catch(console.error);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === selectedId ? { ...n, text: html, updated_at: Date.now() } : n
        )
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

  const handleEditorChange = (html: string) => {
    editorHtmlRef.current = html;

    // Update list immediately so title and date reflect every keystroke
    if (selectedId === null) {
      setDraft(html);
    } else if (typeof selectedId === "string") {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === selectedId ? { ...n, text: html, updated_at: Date.now() } : n
        )
      );
    }

    // Debounce the backend write
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (selectedId === null) {
        invoke("save_draft", { text: html }).catch(console.error);
      } else if (typeof selectedId === "string") {
        invoke("update_note", { id: selectedId, text: html }).catch(console.error);
      }
    }, AUTOSAVE_MS);
  };

  const query = search.toLowerCase();
  const showDraft = draft.trim() && (!query || htmlToPlain(draft).toLowerCase().includes(query));
  const filteredNotes = notes.filter(
    (n) => !query || htmlToPlain(n.text).toLowerCase().includes(query)
  );

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

        {/* Window controls — mirrors Quick Capture */}
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

      {/* ── Body ── */}
      <div className="db-body">

        {/* Notes list */}
        <div className="db-list">
          <div className="db-controls">
            <input
              className="db-search"
              type="text"
              placeholder="Search notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
                {search ? "No notes match your search." : "No saved notes yet."}
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="db-editor-panel">
          <RichEditor
            ref={editorRef}
            onChange={handleEditorChange}
            disabled={selectedId === undefined}
          />
        </div>

      </div>
    </div>
  );
}

export default Database;
