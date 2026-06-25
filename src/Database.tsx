import "./Database.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Note {
  id: string;
  text: string;
  created_at: number;
  updated_at: number;
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim()) ?? "Untitled";
}

function secondLine(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines[1] ?? "";
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) return `Today at ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;

  const month = date.toLocaleString("default", { month: "short" });
  return `${month} ${date.getDate()} at ${time}`;
}

const AUTOSAVE_MS = 500;

function Database() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  // null = draft is selected; string = saved note id is selected
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [editorText, setEditorText] = useState("");
  const [search, setSearch] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Initial load
  useEffect(() => {
    Promise.all([invoke<Note[]>("list_notes"), invoke<string>("load_draft")]).then(
      ([fetchedNotes, fetchedDraft]) => {
        setNotes(fetchedNotes);
        setDraft(fetchedDraft);

        if (fetchedDraft.trim()) {
          setSelectedId(null);
          setEditorText(fetchedDraft);
        } else if (fetchedNotes.length > 0) {
          setSelectedId(fetchedNotes[0].id);
          setEditorText(fetchedNotes[0].text);
        } else {
          setSelectedId(undefined);
          setEditorText("");
        }
      }
    );
  }, []);

  // Refresh note list when window regains focus (picks up new captures)
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

  const selectNote = (id: string | null) => {
    // Flush any pending autosave before switching
    clearTimeout(saveTimer.current);
    const currentText = editorRef.current?.value ?? editorText;
    if (selectedId === null) {
      invoke("save_draft", { text: currentText }).catch(console.error);
    } else if (typeof selectedId === "string") {
      invoke("update_note", { id: selectedId, text: currentText }).catch(console.error);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === selectedId ? { ...n, text: currentText, updated_at: Date.now() } : n
        )
      );
    }

    setSelectedId(id);
    if (id === null) {
      setEditorText(draft);
    } else {
      const note = notes.find((n) => n.id === id);
      setEditorText(note?.text ?? "");
    }
    editorRef.current?.focus();
  };

  const handleEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setEditorText(text);

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (selectedId === null) {
        invoke("save_draft", { text }).catch(console.error);
        setDraft(text);
      } else if (typeof selectedId === "string") {
        invoke("update_note", { id: selectedId, text }).catch(console.error);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === selectedId ? { ...n, text, updated_at: Date.now() } : n
          )
        );
      }
    }, AUTOSAVE_MS);
  };

  const query = search.toLowerCase();
  const showDraft = draft.trim() && (!query || draft.toLowerCase().includes(query));
  const filteredNotes = notes.filter(
    (n) => !query || n.text.toLowerCase().includes(query)
  );

  return (
    <div className="db">
      {/* Sidebar */}
      <aside className="db-sidebar">
        <div className="db-logo">QuikCap</div>
        <nav className="db-nav">
          <div className="db-nav-item db-nav-active">Saved Notes</div>
          <div className="db-nav-item db-nav-inactive">Settings</div>
          <div className="db-nav-item db-nav-inactive">Hotkeys</div>
          <div className="db-nav-item db-nav-inactive">About</div>
        </nav>
      </aside>

      {/* Notes list */}
      <div className="db-list">
        <div className="db-list-header">Saved Notes</div>
        <div className="db-controls">
          <input
            className="db-search"
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="db-sort">
            <option>Last updated</option>
          </select>
        </div>

        <div className="db-cards">
          {/* Active (unfinished) note pinned at top */}
          {showDraft && (
            <button
              className={`db-card db-card-active${selectedId === null ? " db-card-selected" : ""}`}
              onClick={() => selectNote(null)}
            >
              <div className="db-card-top">
                <span className="db-card-title">{firstLine(draft)}</span>
                <span className="db-active-dot" />
              </div>
              <div className="db-card-preview">{secondLine(draft)}</div>
              <div className="db-card-date">Active</div>
            </button>
          )}

          {filteredNotes.map((note) => (
            <button
              key={note.id}
              className={`db-card${selectedId === note.id ? " db-card-selected" : ""}`}
              onClick={() => selectNote(note.id)}
            >
              <div className="db-card-top">
                <span className="db-card-title">{firstLine(note.text)}</span>
              </div>
              <div className="db-card-preview">{secondLine(note.text)}</div>
              <div className="db-card-date">{formatDate(note.updated_at)}</div>
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
        <textarea
          ref={editorRef}
          className="db-editor"
          value={editorText}
          onChange={handleEditorChange}
          spellCheck={false}
          placeholder={selectedId === undefined ? "Select a note to edit" : ""}
          disabled={selectedId === undefined}
        />
      </div>
    </div>
  );
}

export default Database;
