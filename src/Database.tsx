import "./Database.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import RichEditor, { RichEditorHandle } from "./components/RichEditor";

interface Note {
  id: string;
  text: string;
  created_at: number;
  updated_at: number;
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

function secondLine(html: string): string {
  const lines = htmlToPlain(html).split("\n").filter((l) => l.trim());
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

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (selectedId === null) {
        invoke("save_draft", { text: html }).catch(console.error);
        setDraft(html);
        setNotes((prev) =>
          prev.map((n) => (n.id === "draft" ? { ...n, text: html, updated_at: Date.now() } : n))
        );
      } else if (typeof selectedId === "string") {
        invoke("update_note", { id: selectedId, text: html }).catch(console.error);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === selectedId ? { ...n, text: html, updated_at: Date.now() } : n
          )
        );
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
        <RichEditor
          ref={editorRef}
          onChange={handleEditorChange}
          disabled={selectedId === undefined}
        />
      </div>
    </div>
  );
}

export default Database;
