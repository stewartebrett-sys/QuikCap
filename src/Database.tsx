import "./Database.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pin, Calendar, Plus, ChevronLeft, ChevronRight, ArchiveRestore } from "lucide-react";
import type { Editor } from "@tiptap/react";
import RichEditor, { RichEditorHandle } from "./components/RichEditor";
import { EditorToolbar } from "./components/EditorToolbar";
import { searchNotes, type SearchableNote } from "./search";

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

// Reversible note-level operations for the undo stack
type NoteOp =
  | { type: "archive";    note: Note }
  | { type: "pin";        id: string; was: boolean }
  | { type: "follow_up";  id: string; was: string | undefined }
  | { type: "duplicate";  dupId: string };

interface CtxMenu {
  note: Note;
  x: number;
  y: number;
}

interface FollowUpPicker {
  noteId: string;
  currentDate: string | undefined;
  x: number;
  y: number;
}

// ─── Constants ───────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const CTX_MENU_W = 180;
const CTX_MENU_H = 250;
const CAL_W = 220;
const CAL_H = 250;
// Sentinel stored in session.txt when the draft is selected
const SESSION_DRAFT = "__draft__";

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

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "long" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function clampMenu(x: number, y: number, w: number, h: number) {
  return {
    x: Math.min(x, window.innerWidth - w - 8),
    y: Math.min(y, window.innerHeight - h - 8),
  };
}

const AUTOSAVE_MS = 500;
const MAX_UNDO = 50;

// ─── Component ───────────────────────────────────────────

function Database() {
  const appWindow = getCurrentWindow();

  const [notes, setNotes]           = useState<Note[]>([]);
  const [draft, setDraft]           = useState("");
  // undefined = nothing selected; null = draft; string = saved note id
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [search, setSearch]         = useState("");
  const [dbEditor, setDbEditor]     = useState<Editor | null>(null);
  const [dbZoom, setDbZoom]         = useState(100);
  const [ctxMenu, setCtxMenu]       = useState<CtxMenu | null>(null);
  const [followUpPicker, setFollowUpPicker] = useState<FollowUpPicker | null>(null);

  // ── Sprint 9 state ────────────────────────────────────
  const [viewMode, setViewMode]         = useState<"notes" | "archived">("notes");
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([]);
  const [undoStack, setUndoStack]       = useState<NoteOp[]>([]);

  const saveTimer      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef      = useRef<RichEditorHandle>(null);
  const editorHtmlRef  = useRef<string>("");
  const searchRef      = useRef<HTMLInputElement>(null);
  const listRef        = useRef<HTMLDivElement>(null);
  const cardRefs       = useRef<Map<string | null, HTMLButtonElement>>(new Map());
  const createNoteRef  = useRef<() => void>(() => {});
  const deleteNoteRef  = useRef<() => void>(() => {});
  const undoRef        = useRef<() => void>(() => {});

  // ── Initial load + session restore ───────────────────

  useEffect(() => {
    Promise.all([
      invoke<Note[]>("list_notes"),
      invoke<string>("load_draft"),
      invoke<string | null>("load_session"),
    ]).then(([fetchedNotes, fetchedDraft, sessionId]) => {
      const sorted = sortNotes(fetchedNotes);
      setNotes(sorted);
      setDraft(fetchedDraft);

      // Session restore: try to reopen the last-used note
      if (sessionId === SESSION_DRAFT && fetchedDraft.trim()) {
        setSelectedId(null);
        editorHtmlRef.current = fetchedDraft;
        editorRef.current?.setContent(fetchedDraft);
      } else if (sessionId && sessionId !== SESSION_DRAFT) {
        const restored = sorted.find((n) => n.id === sessionId);
        if (restored) {
          setSelectedId(restored.id);
          editorHtmlRef.current = restored.text;
          editorRef.current?.setContent(restored.text);
          return;
        }
      }

      // Fall back to default behaviour
      if (fetchedDraft.trim() && !sessionId) {
        setSelectedId(null);
        editorHtmlRef.current = fetchedDraft;
        editorRef.current?.setContent(fetchedDraft);
      } else if (sorted.length > 0 && !sessionId) {
        setSelectedId(sorted[0].id);
        editorHtmlRef.current = sorted[0].text;
        editorRef.current?.setContent(sorted[0].text);
      } else if (!sessionId) {
        setSelectedId(undefined);
      }
    });
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

  // ── Global keyboard shortcuts ─────────────────────────
  // Ctrl+Z outside the editor fires the app-level undo stack.
  // Inside the editor Tiptap handles Ctrl+Z natively.

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inEditor = document.activeElement?.getAttribute("contenteditable") === "true";

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !inEditor) {
        e.preventDefault();
        undoRef.current();
        return;
      }
      if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        createNoteRef.current();
        return;
      }
      if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Close context menu / follow-up picker on Esc ─────

  useEffect(() => {
    if (!ctxMenu && !followUpPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCtxMenu(null);
        setFollowUpPicker(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ctxMenu, followUpPicker]);

  // ── Scroll selected card into view ────────────────────

  useEffect(() => {
    if (selectedId === undefined) return;
    const el = cardRefs.current.get(selectedId as string | null);
    el?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedId]);

  // ── Save / session helpers ────────────────────────────

  const persistSession = (id: string | null | undefined) => {
    const sessionId = id === null ? SESSION_DRAFT : (id ?? "");
    invoke("save_session", { noteId: sessionId || null }).catch(console.error);
  };

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
    persistSession(id);
  };

  const selectNoteKeyboard = (id: string | null) => {
    flushSave();
    setSelectedId(id);
    const content = id === null ? draft : (notes.find((n) => n.id === id)?.text ?? "");
    editorHtmlRef.current = content;
    editorRef.current?.setContent(content);
    persistSession(id);
  };

  // ── Undo stack ────────────────────────────────────────

  const pushUndo = (op: NoteOp) =>
    setUndoStack((prev) => [...prev.slice(-MAX_UNDO + 1), op]);

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const op = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    try {
      switch (op.type) {
        case "archive": {
          await invoke("restore_note", { id: op.note.id });
          setNotes((prev) => sortNotes([{ ...op.note, status: "active" }, ...prev]));
          selectNote(op.note.id);
          break;
        }
        case "pin": {
          await invoke("pin_note", { id: op.id, pinned: op.was });
          setNotes((prev) => sortNotes(prev.map((n) => n.id === op.id ? { ...n, pinned: op.was } : n)));
          break;
        }
        case "follow_up": {
          await invoke("set_follow_up", { id: op.id, date: op.was ?? null });
          setNotes((prev) => sortNotes(prev.map((n) =>
            n.id === op.id ? { ...n, follow_up_date: op.was } : n
          )));
          break;
        }
        case "duplicate": {
          await invoke("delete_note", { id: op.dupId });
          setNotes((prev) => sortNotes(prev.filter((n) => n.id !== op.dupId)));
          break;
        }
      }
    } catch (e) { console.error("Undo failed:", e); }
  };

  undoRef.current = handleUndo;

  // ── New note ──────────────────────────────────────────

  const createNewNote = async () => {
    const existing = notes.find((n) => !htmlToPlain(n.text).trim());
    if (existing) { selectNote(existing.id); return; }
    if (typeof selectedId === "string") {
      const current = notes.find((n) => n.id === selectedId);
      if (current && !htmlToPlain(current.text).trim()) { editorRef.current?.focus(); return; }
    }
    try {
      const newNote = await invoke<Note>("create_note");
      setNotes((prev) => sortNotes([newNote, ...prev]));
      setSelectedId(newNote.id);
      editorHtmlRef.current = "";
      editorRef.current?.setContent("");
      editorRef.current?.focus();
      persistSession(newNote.id);
    } catch (e) { console.error("Failed to create note:", e); }
  };

  createNoteRef.current = createNewNote;

  // ── Remove from list (shared by archive + delete) ─────

  const handleNoteRemoved = (id: string, remaining: Note[]) => {
    if (selectedId !== id) return;
    if (remaining.length > 0) {
      setSelectedId(remaining[0].id);
      editorHtmlRef.current = remaining[0].text;
      editorRef.current?.setContent(remaining[0].text);
    } else {
      setSelectedId(undefined);
      editorHtmlRef.current = "";
      editorRef.current?.setContent("");
    }
  };

  // ── Delete (archive) — keyboard shortcut ──────────────

  const deleteSelectedNote = async () => {
    if (typeof selectedId !== "string") return;
    const noteToArchive = notes.find((n) => n.id === selectedId);
    clearTimeout(saveTimer.current);
    try { await invoke("archive_note", { id: selectedId }); }
    catch (e) { console.error(e); return; }

    if (noteToArchive) pushUndo({ type: "archive", note: noteToArchive });

    const remaining = sortNotes(notes.filter((n) => n.id !== selectedId));
    setNotes(remaining);

    if (remaining.length > 0) {
      setSelectedId(remaining[0].id);
      editorHtmlRef.current = remaining[0].text;
      editorRef.current?.setContent(remaining[0].text);
      listRef.current?.focus();
    } else if (draft.trim()) {
      setSelectedId(null);
      editorHtmlRef.current = draft;
      editorRef.current?.setContent(draft);
      listRef.current?.focus();
    } else {
      setSelectedId(undefined);
      editorHtmlRef.current = "";
      editorRef.current?.setContent("");
      try {
        const newNote = await invoke<Note>("create_note");
        setNotes([newNote]);
        setSelectedId(newNote.id);
        listRef.current?.focus();
      } catch (e) { console.error(e); }
    }
  };

  deleteNoteRef.current = deleteSelectedNote;

  // ── Editor change ─────────────────────────────────────

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
      if (selectedId === null) invoke("save_draft", { text: html }).catch(console.error);
      else if (typeof selectedId === "string") invoke("update_note", { id: selectedId, text: html }).catch(console.error);
    }, AUTOSAVE_MS);
  };

  const handleZoomChange = (z: number) => {
    setDbZoom(z);
    editorRef.current?.setZoom(z);
  };

  // ── Archive view ──────────────────────────────────────

  const switchToArchived = async () => {
    const archived = await invoke<Note[]>("list_archived_notes").catch(() => []);
    setArchivedNotes(archived);
    setViewMode("archived");
  };

  const switchToNotes = () => setViewMode("notes");

  const handleRestoreNote = async (id: string) => {
    setCtxMenu(null);
    try {
      await invoke("restore_note", { id });
      const restored = archivedNotes.find((n) => n.id === id);
      setArchivedNotes((prev) => prev.filter((n) => n.id !== id));
      if (restored) {
        const active = { ...restored, status: "active" };
        setNotes((prev) => sortNotes([active, ...prev]));
        switchToNotes();
        selectNote(id);
      }
    } catch (e) { console.error(e); }
  };

  const handlePermanentDeleteArchived = async (id: string) => {
    setCtxMenu(null);
    try {
      await invoke("delete_note", { id });
      setArchivedNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) { console.error(e); }
  };

  // ── Context menu handlers ─────────────────────────────

  const handleContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    if (note.status !== "archived") selectNoteKeyboard(note.id);
    const pos = clampMenu(e.clientX, e.clientY, CTX_MENU_W, CTX_MENU_H);
    setCtxMenu({ note, x: pos.x, y: pos.y });
  };

  const ctxOpen = () => {
    if (!ctxMenu) return;
    selectNote(ctxMenu.note.id);
    setCtxMenu(null);
  };

  const ctxPin = async () => {
    if (!ctxMenu) return;
    const { note } = ctxMenu;
    const newPinned = !note.pinned;
    setCtxMenu(null);
    try {
      await invoke("pin_note", { id: note.id, pinned: newPinned });
      setNotes((prev) => sortNotes(prev.map((n) => n.id === note.id ? { ...n, pinned: newPinned } : n)));
      pushUndo({ type: "pin", id: note.id, was: note.pinned });
    } catch (e) { console.error(e); }
  };

  const ctxFollowUp = () => {
    if (!ctxMenu) return;
    const pos = clampMenu(ctxMenu.x, ctxMenu.y, CAL_W, CAL_H);
    setFollowUpPicker({ noteId: ctxMenu.note.id, currentDate: ctxMenu.note.follow_up_date, x: pos.x, y: pos.y });
    setCtxMenu(null);
  };

  const handleFollowUpSelect = async (date: Date | null) => {
    if (!followUpPicker) return;
    const prevDate = followUpPicker.currentDate;
    const dateStr = date ? toISODate(date) : null;
    setFollowUpPicker(null);
    try {
      await invoke("set_follow_up", { id: followUpPicker.noteId, date: dateStr });
      setNotes((prev) => sortNotes(prev.map((n) =>
        n.id === followUpPicker.noteId ? { ...n, follow_up_date: dateStr ?? undefined } : n
      )));
      pushUndo({ type: "follow_up", id: followUpPicker.noteId, was: prevDate });
    } catch (e) { console.error(e); }
  };

  const ctxDuplicate = async () => {
    if (!ctxMenu) return;
    const id = ctxMenu.note.id;
    setCtxMenu(null);
    try {
      const dup = await invoke<Note>("duplicate_note", { id });
      setNotes((prev) => sortNotes([dup, ...prev]));
      pushUndo({ type: "duplicate", dupId: dup.id });
      selectNote(dup.id);
    } catch (e) { console.error("Failed to duplicate note:", e); }
  };

  const ctxArchive = async () => {
    if (!ctxMenu) return;
    const { note } = ctxMenu;
    setCtxMenu(null);
    clearTimeout(saveTimer.current);
    try { await invoke("archive_note", { id: note.id }); }
    catch (e) { console.error(e); return; }
    pushUndo({ type: "archive", note });
    const remaining = sortNotes(notes.filter((n) => n.id !== note.id));
    setNotes(remaining);
    handleNoteRemoved(note.id, remaining);
  };

  const ctxDelete = async () => {
    if (!ctxMenu) return;
    const id = ctxMenu.note.id;
    setCtxMenu(null);
    clearTimeout(saveTimer.current);
    try { await invoke("delete_note", { id }); }
    catch (e) { console.error(e); return; }
    const remaining = sortNotes(notes.filter((n) => n.id !== id));
    setNotes(remaining);
    handleNoteRemoved(id, remaining);
  };

  // ── Search — memoized index + ranked results ──────────

  const query = search.trim();

  const noteIndex = useMemo<SearchableNote[]>(
    () => notes.map((n) => ({
      id: n.id,
      title: firstLine(n.text),
      body: htmlToPlain(n.text),
      updated_at: n.updated_at,
    })),
    [notes]
  );

  const filteredNotes: Note[] = useMemo(() => {
    if (!query) return sortNotes(notes);
    const ids = searchNotes(noteIndex, query);
    const map = new Map(notes.map((n) => [n.id, n]));
    return ids.map((id) => map.get(id)).filter(Boolean) as Note[];
  }, [notes, noteIndex, query]);

  const showDraft = !!(
    draft.trim() &&
    (!query || htmlToPlain(draft).toLowerCase().includes(query.toLowerCase()))
  );

  const editorDisabled = selectedId === undefined;

  // ── List keyboard handler ─────────────────────────────

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (viewMode === "archived") return; // no keyboard nav in archive view
    const visibleIds: (string | null)[] = [
      ...(showDraft ? [null as null] : []),
      ...filteredNotes.map((n) => n.id),
    ];
    const currentIdx =
      selectedId === undefined ? -1 : visibleIds.indexOf(selectedId as string | null);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, visibleIds.length - 1);
        if (nextIdx >= 0 && nextIdx !== currentIdx) selectNoteKeyboard(visibleIds[nextIdx]);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prevIdx = Math.max(currentIdx - 1, 0);
        if (prevIdx >= 0 && prevIdx < visibleIds.length && prevIdx !== currentIdx)
          selectNoteKeyboard(visibleIds[prevIdx]);
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (!editorDisabled) editorRef.current?.focus();
        break;
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        deleteNoteRef.current();
        break;
      }
    }
  };

  // ── Search keyboard handler ───────────────────────────

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (search) { setSearch(""); }
    else { (e.target as HTMLInputElement).blur(); editorRef.current?.focus(); }
  };

  // ── Render ────────────────────────────────────────────

  const isArchiveView = viewMode === "archived";
  const displayNotes = isArchiveView ? archivedNotes : filteredNotes;

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
        {dbEditor && !editorDisabled && !isArchiveView && (
          <div className="db-toolbar-surface">
            <EditorToolbar editor={dbEditor} zoom={dbZoom} onZoomChange={handleZoomChange} />
          </div>
        )}

        <div className="db-main-surface">

          {/* ── Notes list pane ── */}
          <div className="db-list">

            {/* List header — changes between Notes and Archived views */}
            <div className="db-list-header">
              {isArchiveView ? (
                <>
                  <button className="db-list-back-btn" onClick={switchToNotes} title="Back to Notes">
                    <ChevronLeft size={13} strokeWidth={2.5} />
                  </button>
                  <span className="db-list-label">Archived</span>
                </>
              ) : (
                <>
                  <span className="db-list-label">Notes</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      className="db-list-add-btn"
                      onClick={switchToArchived}
                      title="View archived notes"
                    >
                      <ArchiveRestore size={13} strokeWidth={2} />
                    </button>
                    <button
                      className="db-list-add-btn"
                      onClick={createNewNote}
                      title="New note (Ctrl+N)"
                    >
                      <Plus size={14} strokeWidth={2} />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Scrollable card list */}
            <div
              className="db-cards"
              tabIndex={0}
              ref={listRef}
              onKeyDown={onListKeyDown}
            >
              {/* Draft (notes view only) */}
              {!isArchiveView && showDraft && (
                <button
                  ref={(el) => { if (el) cardRefs.current.set(null, el); else cardRefs.current.delete(null); }}
                  className={`db-card db-card-draft${selectedId === null ? " db-card-selected" : ""}`}
                  onClick={() => selectNote(null)}
                >
                  <span className="db-card-title"><HighlightedText text={firstLine(draft)} query={query} /></span>
                  <div className="db-card-meta">
                    <span className="db-active-dot" title="Active in Capture" />
                    <span className="db-card-date">Capture</span>
                  </div>
                </button>
              )}

              {/* Note rows (shared between notes and archive views) */}
              {displayNotes.map((note) => (
                <button
                  key={note.id}
                  ref={(el) => {
                    if (!isArchiveView) {
                      if (el) cardRefs.current.set(note.id, el);
                      else cardRefs.current.delete(note.id);
                    }
                  }}
                  className={`db-card${!isArchiveView && selectedId === note.id ? " db-card-selected" : ""}`}
                  onClick={() => { if (!isArchiveView) selectNote(note.id); }}
                  onContextMenu={(e) => handleContextMenu(e, note)}
                >
                  <span className="db-card-title">
                    {isArchiveView
                      ? firstLine(note.text)
                      : <HighlightedText text={firstLine(note.text)} query={query} />}
                  </span>
                  <div className="db-card-meta">
                    {note.pinned && <Pin size={9} strokeWidth={2.5} className="db-icon-pin" />}
                    {note.follow_up_date && <Calendar size={9} strokeWidth={2.5} className="db-icon-cal" />}
                    <span className="db-card-date">{smartDate(note.updated_at)}</span>
                  </div>
                </button>
              ))}

              {/* Empty states */}
              {!isArchiveView && !showDraft && filteredNotes.length === 0 && (
                <div className="db-empty">
                  {query ? (
                    <>
                      <div className="db-empty-title">No notes found</div>
                      <div className="db-empty-hint">Try searching titles or note contents.</div>
                    </>
                  ) : "No saved notes yet."}
                </div>
              )}
              {isArchiveView && archivedNotes.length === 0 && (
                <div className="db-empty">
                  <div className="db-empty-title">Archive is empty</div>
                  <div className="db-empty-hint">Archived notes appear here.</div>
                </div>
              )}
            </div>
          </div>

          {/* ── Editor panel ── */}
          <div className="db-editor-panel">
            <div className="db-editor-header">
              <input
                ref={searchRef}
                className="db-search"
                type="text"
                placeholder="Search notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </div>
            <RichEditor
              ref={editorRef}
              onChange={handleEditorChange}
              disabled={editorDisabled}
              hideToolbar={true}
              onEditorReady={(e) => setDbEditor(e)}
              onZoomChange={(z) => setDbZoom(z)}
              onEscape={() => listRef.current?.focus()}
              searchQuery={query}
            />
          </div>

        </div>
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <>
          <div className="db-overlay" onClick={() => setCtxMenu(null)} />
          <div className="db-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            {ctxMenu.note.status === "archived" ? (
              /* Archive-view menu */
              <>
                <button className="db-ctx-item" onClick={() => handleRestoreNote(ctxMenu.note.id)}>
                  Restore
                </button>
                <div className="db-ctx-sep" />
                <button className="db-ctx-item db-ctx-item--danger" onClick={() => handlePermanentDeleteArchived(ctxMenu.note.id)}>
                  Delete Permanently
                </button>
              </>
            ) : (
              /* Normal menu */
              <>
                <button className="db-ctx-item" onClick={ctxOpen}>Open</button>
                <div className="db-ctx-sep" />
                <button className="db-ctx-item" onClick={ctxPin}>
                  {ctxMenu.note.pinned ? "Unpin" : "Pin"}
                </button>
                <button className="db-ctx-item" onClick={ctxFollowUp}>
                  {ctxMenu.note.follow_up_date ? "Edit Follow Up" : "Add Follow Up"}
                </button>
                <button className="db-ctx-item" onClick={ctxDuplicate}>Duplicate</button>
                <div className="db-ctx-sep" />
                <button className="db-ctx-item" onClick={ctxArchive}>Archive</button>
                <button className="db-ctx-item db-ctx-item--danger" onClick={ctxDelete}>Delete</button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Follow-up calendar ── */}
      {followUpPicker && (
        <>
          <div className="db-overlay" onClick={() => setFollowUpPicker(null)} />
          <DbCalendarPicker
            x={followUpPicker.x}
            y={followUpPicker.y}
            currentDate={followUpPicker.currentDate}
            onSelect={handleFollowUpSelect}
            onClose={() => setFollowUpPicker(null)}
          />
        </>
      )}

    </div>
  );
}

// ─── Inline text highlighter ─────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let idx = lt.indexOf(lq);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={key++} className="search-highlight">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    last = idx + query.length;
    idx = lt.indexOf(lq, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// ─── Inline calendar picker for follow-up dates ──────────

interface DbCalendarProps {
  x: number;
  y: number;
  currentDate: string | undefined;
  onSelect: (date: Date | null) => void;
  onClose: () => void;
}

function DbCalendarPicker({ x, y, currentDate, onSelect, onClose }: DbCalendarProps) {
  const selected = currentDate ? new Date(currentDate + "T12:00:00") : null;
  const today = new Date();
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const isToday = (d: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;
  const isSelected = (d: number) =>
    !!selected && selected.getFullYear() === viewYear && selected.getMonth() === viewMonth && selected.getDate() === d;

  const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="db-cal-pop" style={{ left: x, top: y }}>
      <div className="db-cal-header">
        <button className="db-cal-nav" onMouseDown={(e) => { e.preventDefault(); prevMonth(); }}>
          <ChevronLeft size={13} strokeWidth={2} />
        </button>
        <span className="db-cal-title">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className="db-cal-nav" onMouseDown={(e) => { e.preventDefault(); nextMonth(); }}>
          <ChevronRight size={13} strokeWidth={2} />
        </button>
      </div>
      <div className="db-cal-grid">
        {DAY_LABELS.map((d) => <div key={d} className="db-cal-dow">{d}</div>)}
        {cells.map((d, i) =>
          d === null ? (
            <div key={`e-${i}`} />
          ) : (
            <button
              key={`d-${i}`}
              className={["db-cal-day", isToday(d) ? "db-cal-day--today" : "", isSelected(d) ? "db-cal-day--selected" : ""].filter(Boolean).join(" ")}
              onMouseDown={(e) => { e.preventDefault(); onSelect(new Date(viewYear, viewMonth, d)); onClose(); }}
            >
              {d}
            </button>
          )
        )}
      </div>
      {selected && (
        <div className="db-cal-footer">
          <button className="db-cal-clear" onMouseDown={(e) => { e.preventDefault(); onSelect(null); onClose(); }}>
            Clear date
          </button>
        </div>
      )}
    </div>
  );
}

export default Database;
