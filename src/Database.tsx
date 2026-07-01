import "./Database.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pin, Calendar, Plus, ChevronDown, ChevronLeft, ChevronRight, Check } from "lucide-react";
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

type ActiveView =
  | "all" | "pinned" | "follow-up" | "archived"
  | "recently-edited" | "recently-created";

type NoteOp =
  | { type: "archive";    note: Note }
  | { type: "pin";        id: string; was: boolean }
  | { type: "follow_up";  id: string; was: string | undefined }
  | { type: "duplicate";  dupId: string };

// ── Context menu — three kinds share one state slot ────────
type AnyCtx =
  | { kind: "note";   note: Note; x: number; y: number }
  | { kind: "empty";            x: number; y: number }
  | { kind: "editor";           x: number; y: number };

// ── Data-driven menu item ──────────────────────────────────
type MenuItem =
  | { type: "sep" }
  | { type: "item"; label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onClick: () => void };

interface FollowUpPicker {
  noteId: string;
  currentDate: string | undefined;
  x: number;
  y: number;
}

interface DeleteConfirm {
  id: string;
  label: string;
  permanent: boolean;
}

// ─── Constants ───────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const SESSION_DRAFT = "__draft__";
const AUTOSAVE_MS   = 500;
const MAX_UNDO      = 50;
const CAL_W         = 220;
const CAL_H         = 250;

const VIEW_LABELS: Record<ActiveView, string> = {
  "all":              "All Notes",
  "pinned":           "Pinned",
  "follow-up":        "Follow Up",
  "archived":         "Archived",
  "recently-edited":  "Recently Edited",
  "recently-created": "Recently Created",
};

// ─── Utilities ───────────────────────────────────────────

function htmlToPlain(html: string): string {
  return html
    .replace(/<\/p>/gi,"\n").replace(/<\/li>/gi,"\n").replace(/<br\s*\/?>/gi,"\n")
    .replace(/<[^>]*>/g,"")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ")
    .trim();
}
function firstLine(html: string): string {
  return htmlToPlain(html).split("\n").find(l => l.trim()) ?? "New Note";
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
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
  const date = new Date(ms), now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  const yest = new Date(now); yest.setDate(now.getDate()-1);
  if (date.toDateString() === yest.toDateString()) return "Yesterday";
  const diff = Math.floor((now.getTime()-date.getTime())/86_400_000);
  if (diff < 7) return date.toLocaleDateString([], { weekday:"long" });
  if (date.getFullYear() === now.getFullYear())
    return date.toLocaleDateString([], { month:"short", day:"numeric" });
  return date.toLocaleDateString([], { month:"short", day:"numeric", year:"numeric" });
}
function clampMenu(x: number, y: number, w: number, h: number) {
  return { x: Math.min(x, window.innerWidth-w-8), y: Math.min(y, window.innerHeight-h-8) };
}

// ─── Component ───────────────────────────────────────────

function Database() {
  const appWindow = getCurrentWindow();

  const [notes, setNotes]           = useState<Note[]>([]);
  const [draft, setDraft]           = useState("");
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [search, setSearch]         = useState("");
  const [dbEditor, setDbEditor]     = useState<Editor | null>(null);
  const [dbZoom, setDbZoom]         = useState(100);
  const [ctxMenu, setCtxMenu]       = useState<AnyCtx | null>(null);
  const [followUpPicker, setFollowUpPicker] = useState<FollowUpPicker | null>(null);
  const [deleteConfirm, setDeleteConfirm]   = useState<DeleteConfirm | null>(null);

  const [activeView, setActiveView]         = useState<ActiveView>("all");
  const [archivedNotes, setArchivedNotes]   = useState<Note[]>([]);
  const [undoStack, setUndoStack]           = useState<NoteOp[]>([]);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [viewDropdownRect, setViewDropdownRect] = useState<{ left:number; top:number; width:number }|null>(null);

  const saveTimer     = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const editorRef     = useRef<RichEditorHandle>(null);
  const editorHtmlRef = useRef<string>("");
  const searchRef     = useRef<HTMLInputElement>(null);
  const listRef       = useRef<HTMLDivElement>(null);
  const listHeaderRef = useRef<HTMLDivElement>(null);
  const cardRefs      = useRef<Map<string|null, HTMLButtonElement>>(new Map());
  const createNoteRef = useRef<()=>void>(()=>{});
  const deleteNoteRef = useRef<()=>void>(()=>{});
  const duplicateRef  = useRef<()=>void>(()=>{});
  const undoRef       = useRef<()=>void>(()=>{});

  // ── Initial load + session restore ───────────────────

  useEffect(() => {
    Promise.all([
      invoke<Note[]>("list_notes"),
      invoke<string>("load_draft"),
      invoke<string|null>("load_session"),
    ]).then(([fetchedNotes, fetchedDraft, sessionId]) => {
      const sorted = sortNotes(fetchedNotes);
      setNotes(sorted); setDraft(fetchedDraft);
      if (sessionId === SESSION_DRAFT && fetchedDraft.trim()) {
        setSelectedId(null); editorHtmlRef.current = fetchedDraft; editorRef.current?.setContent(fetchedDraft);
      } else if (sessionId && sessionId !== SESSION_DRAFT) {
        const r = sorted.find(n => n.id === sessionId);
        if (r) { setSelectedId(r.id); editorHtmlRef.current = r.text; editorRef.current?.setContent(r.text); return; }
      }
      if (fetchedDraft.trim() && !sessionId) { setSelectedId(null); editorHtmlRef.current = fetchedDraft; editorRef.current?.setContent(fetchedDraft); }
      else if (sorted.length > 0 && !sessionId) { setSelectedId(sorted[0].id); editorHtmlRef.current = sorted[0].text; editorRef.current?.setContent(sorted[0].text); }
      else if (!sessionId) setSelectedId(undefined);
    });
  }, []);

  // ── Refresh on window focus ───────────────────────────

  useEffect(() => {
    const fn = () => Promise.all([invoke<Note[]>("list_notes"), invoke<string>("load_draft")]).then(
      ([n, d]) => { setNotes(sortNotes(n)); setDraft(d); }
    );
    window.addEventListener("focus", fn);
    return () => window.removeEventListener("focus", fn);
  }, []);

  // ── Global keyboard shortcuts ─────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inEditor = document.activeElement?.getAttribute("contenteditable") === "true";
      if (e.key === "z" && (e.ctrlKey||e.metaKey) && !e.shiftKey && !inEditor) { e.preventDefault(); undoRef.current(); return; }
      if (e.key === "n" && (e.ctrlKey||e.metaKey))  { e.preventDefault(); createNoteRef.current(); return; }
      if (e.key === "f" && (e.ctrlKey||e.metaKey))  { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (e.key === "d" && (e.ctrlKey||e.metaKey) && !inEditor) { e.preventDefault(); duplicateRef.current(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Close overlays on Esc ─────────────────────────────

  useEffect(() => {
    if (!ctxMenu && !followUpPicker && !viewDropdownOpen) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setCtxMenu(null); setFollowUpPicker(null); setViewDropdownOpen(false);
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [ctxMenu, followUpPicker, viewDropdownOpen]);

  // ── Scroll selected card into view ────────────────────

  useEffect(() => {
    if (selectedId === undefined) return;
    cardRefs.current.get(selectedId as string|null)?.scrollIntoView({ block:"nearest", behavior:"auto" });
  }, [selectedId]);

  // ── Load archived notes when switching to that view ───

  useEffect(() => {
    if (activeView === "archived")
      invoke<Note[]>("list_archived_notes").then(setArchivedNotes).catch(()=>{});
  }, [activeView]);

  // ── Session + save helpers ────────────────────────────

  const persistSession = (id: string|null|undefined) =>
    invoke("save_session", { noteId: id===null ? SESSION_DRAFT : (id ?? "") || null }).catch(console.error);

  const flushSave = () => {
    clearTimeout(saveTimer.current);
    const html = editorHtmlRef.current;
    if (selectedId === null) invoke("save_draft", { text: html }).catch(console.error);
    else if (typeof selectedId === "string") {
      invoke("update_note", { id: selectedId, text: html }).catch(console.error);
      setNotes(prev => prev.map(n => n.id===selectedId ? {...n, text:html, updated_at:Date.now()} : n));
    }
  };

  const selectNote = (id: string|null) => {
    flushSave(); setSelectedId(id);
    const content = id===null ? draft : ((notes.find(n=>n.id===id) ?? archivedNotes.find(n=>n.id===id))?.text ?? "");
    editorHtmlRef.current = content; editorRef.current?.setContent(content); editorRef.current?.focus(); persistSession(id);
  };

  const selectNoteKeyboard = (id: string|null) => {
    flushSave(); setSelectedId(id);
    const content = id===null ? draft : ((notes.find(n=>n.id===id) ?? archivedNotes.find(n=>n.id===id))?.text ?? "");
    editorHtmlRef.current = content; editorRef.current?.setContent(content); persistSession(id);
  };

  // ── View selector ─────────────────────────────────────

  const openViewDropdown = () => {
    const r = listHeaderRef.current?.getBoundingClientRect();
    if (r) { setViewDropdownRect({ left:r.left, top:r.bottom+2, width:r.width }); setViewDropdownOpen(true); }
  };
  const switchView = (v: ActiveView) => { setActiveView(v); setViewDropdownOpen(false); setSearch(""); };

  // ── Undo stack ────────────────────────────────────────

  const pushUndo = (op: NoteOp) => setUndoStack(prev => [...prev.slice(-MAX_UNDO+1), op]);

  const handleUndo = async () => {
    if (!undoStack.length) return;
    const op = undoStack[undoStack.length-1];
    setUndoStack(prev => prev.slice(0,-1));
    try {
      if (op.type === "archive") {
        await invoke("restore_note", { id: op.note.id });
        const r = { ...op.note, status:"active" };
        setNotes(prev => sortNotes([r, ...prev]));
        setActiveView("all"); setSelectedId(r.id); editorHtmlRef.current = r.text; editorRef.current?.setContent(r.text); editorRef.current?.focus(); persistSession(r.id);
      } else if (op.type === "pin") {
        await invoke("pin_note", { id:op.id, pinned:op.was });
        setNotes(prev => sortNotes(prev.map(n => n.id===op.id ? {...n, pinned:op.was} : n)));
      } else if (op.type === "follow_up") {
        await invoke("set_follow_up", { id:op.id, date:op.was??null });
        setNotes(prev => sortNotes(prev.map(n => n.id===op.id ? {...n, follow_up_date:op.was} : n)));
      } else if (op.type === "duplicate") {
        await invoke("delete_note", { id:op.dupId });
        setNotes(prev => sortNotes(prev.filter(n => n.id!==op.dupId)));
      }
    } catch (e) { console.error("Undo failed:", e); }
  };
  undoRef.current = handleUndo;

  // ── New note ──────────────────────────────────────────

  const createNewNote = async () => {
    const existing = notes.find(n => !htmlToPlain(n.text).trim());
    if (existing) { selectNote(existing.id); return; }
    if (typeof selectedId === "string") {
      const cur = notes.find(n => n.id===selectedId);
      if (cur && !htmlToPlain(cur.text).trim()) { editorRef.current?.focus(); return; }
    }
    try {
      const nn = await invoke<Note>("create_note");
      setNotes(prev => sortNotes([nn, ...prev])); setSelectedId(nn.id);
      editorHtmlRef.current = ""; editorRef.current?.setContent(""); editorRef.current?.focus(); persistSession(nn.id);
    } catch (e) { console.error(e); }
  };
  createNoteRef.current = createNewNote;

  // ── Remove note helper ────────────────────────────────

  const handleNoteRemoved = (id: string, remaining: Note[]) => {
    if (selectedId !== id) return;
    if (remaining.length > 0) {
      setSelectedId(remaining[0].id); editorHtmlRef.current = remaining[0].text; editorRef.current?.setContent(remaining[0].text);
    } else {
      setSelectedId(undefined); editorHtmlRef.current = ""; editorRef.current?.setContent("");
    }
  };

  // ── Keyboard Delete/Backspace — archive ───────────────

  const deleteSelectedNote = async () => {
    if (typeof selectedId !== "string") return;
    const note = notes.find(n => n.id===selectedId);
    clearTimeout(saveTimer.current);
    try { await invoke("archive_note", { id:selectedId }); } catch (e) { console.error(e); return; }
    if (note) pushUndo({ type:"archive", note });
    const rem = sortNotes(notes.filter(n => n.id!==selectedId));
    setNotes(rem);
    if (rem.length > 0) {
      setSelectedId(rem[0].id); editorHtmlRef.current = rem[0].text; editorRef.current?.setContent(rem[0].text); listRef.current?.focus();
    } else if (draft.trim()) {
      setSelectedId(null); editorHtmlRef.current = draft; editorRef.current?.setContent(draft); listRef.current?.focus();
    } else {
      setSelectedId(undefined); editorHtmlRef.current = ""; editorRef.current?.setContent("");
      try {
        const nn = await invoke<Note>("create_note"); setNotes([nn]); setSelectedId(nn.id); listRef.current?.focus();
      } catch (e) { console.error(e); }
    }
  };
  deleteNoteRef.current = deleteSelectedNote;

  // ── Editor change ─────────────────────────────────────

  const handleEditorChange = (html: string) => {
    editorHtmlRef.current = html;
    if (selectedId === null) setDraft(html);
    else if (typeof selectedId === "string")
      setNotes(prev => prev.map(n => n.id===selectedId ? {...n, text:html, updated_at:Date.now()} : n));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (selectedId===null) invoke("save_draft", {text:html}).catch(console.error);
      else if (typeof selectedId==="string") invoke("update_note", {id:selectedId, text:html}).catch(console.error);
    }, AUTOSAVE_MS);
  };

  const handleZoomChange = (z: number) => { setDbZoom(z); editorRef.current?.setZoom(z); };

  // ── Restore archived note ─────────────────────────────

  const handleRestoreNote = async (id: string) => {
    try {
      await invoke("restore_note", { id });
      const r = archivedNotes.find(n => n.id===id);
      setArchivedNotes(prev => prev.filter(n => n.id!==id));
      if (r) {
        const active = { ...r, status:"active" };
        setNotes(prev => sortNotes([active, ...prev]));
        setActiveView("all"); setSelectedId(active.id);
        editorHtmlRef.current = active.text; editorRef.current?.setContent(active.text); editorRef.current?.focus(); persistSession(active.id);
      }
    } catch (e) { console.error(e); }
  };

  // ── Delete confirmation ───────────────────────────────

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await invoke("delete_note", { id });
      const rem = sortNotes(notes.filter(n => n.id!==id));
      setNotes(rem);
      setArchivedNotes(prev => prev.filter(n => n.id!==id));
      handleNoteRemoved(id, rem);
    } catch (e) { console.error(e); }
  };

  // ── Note action handlers (called from menu items) ─────

  const handleCtxPin = async (note: Note) => {
    const newPinned = !note.pinned;
    try {
      await invoke("pin_note", { id:note.id, pinned:newPinned });
      setNotes(prev => sortNotes(prev.map(n => n.id===note.id ? {...n, pinned:newPinned} : n)));
      pushUndo({ type:"pin", id:note.id, was:note.pinned });
    } catch (e) { console.error(e); }
  };

  const handleCtxFollowUp = (note: Note, menuX: number, menuY: number) => {
    const pos = clampMenu(menuX, menuY, CAL_W, CAL_H);
    setFollowUpPicker({ noteId:note.id, currentDate:note.follow_up_date, x:pos.x, y:pos.y });
  };

  const handleFollowUpSelect = async (date: Date|null) => {
    if (!followUpPicker) return;
    const prevDate = followUpPicker.currentDate;
    const dateStr = date ? toISODate(date) : null;
    setFollowUpPicker(null);
    try {
      await invoke("set_follow_up", { id:followUpPicker.noteId, date:dateStr });
      setNotes(prev => sortNotes(prev.map(n =>
        n.id===followUpPicker.noteId ? {...n, follow_up_date:dateStr??undefined} : n
      )));
      pushUndo({ type:"follow_up", id:followUpPicker.noteId, was:prevDate });
    } catch (e) { console.error(e); }
  };

  const handleCtxDuplicate = async (note: Note) => {
    try {
      const dup = await invoke<Note>("duplicate_note", { id:note.id });
      setNotes(prev => sortNotes([dup, ...prev]));
      pushUndo({ type:"duplicate", dupId:dup.id });
      if (note.status === "archived") setActiveView("all");
      selectNote(dup.id);
    } catch (e) { console.error(e); }
  };
  duplicateRef.current = () => {
    if (typeof selectedId !== "string") return;
    const note = notes.find(n => n.id===selectedId);
    if (note) handleCtxDuplicate(note);
  };

  const handleCtxArchive = async (note: Note) => {
    clearTimeout(saveTimer.current);
    try { await invoke("archive_note", { id:note.id }); } catch (e) { console.error(e); return; }
    pushUndo({ type:"archive", note });
    const rem = sortNotes(notes.filter(n => n.id!==note.id));
    setNotes(rem);
    handleNoteRemoved(note.id, rem);
  };

  const handleCtxRename = (note: Note) => {
    if (selectedId !== note.id) selectNoteKeyboard(note.id);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      dbEditor?.chain().focus("start").run();
    });
  };

  const refreshNotes = () => {
    invoke<Note[]>("list_notes").then(n => setNotes(sortNotes(n))).catch(console.error);
  };

  const handleEmptyPaste = async () => {
    const text = await navigator.clipboard.readText().catch(()=>"");
    if (!text) return;
    try {
      const nn = await invoke<Note>("create_note");
      const html = "<p>" + text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"</p><p>") + "</p>";
      await invoke("update_note", { id:nn.id, text:html });
      const updated = { ...nn, text:html };
      setNotes(prev => sortNotes([updated, ...prev]));
      setSelectedId(updated.id); editorHtmlRef.current = updated.text; editorRef.current?.setContent(updated.text); editorRef.current?.focus(); persistSession(updated.id);
    } catch (e) { console.error(e); }
  };

  // ── Editor context menu actions ───────────────────────

  const editorUndo     = () => dbEditor?.chain().focus().undo().run();
  const editorRedo     = () => dbEditor?.chain().focus().redo().run();
  const editorCopy     = async () => {
    if (!dbEditor) return;
    const { from, to } = dbEditor.state.selection;
    if (from === to) return;
    const text = dbEditor.state.doc.textBetween(from, to, "\n");
    await navigator.clipboard.writeText(text).catch(()=>{});
  };
  const editorCut = async () => {
    if (!dbEditor) return;
    const { from, to } = dbEditor.state.selection;
    if (from === to) return;
    const text = dbEditor.state.doc.textBetween(from, to, "\n");
    await navigator.clipboard.writeText(text).catch(()=>{});
    dbEditor.commands.deleteSelection();
  };
  const editorPaste     = async () => {
    const text = await navigator.clipboard.readText().catch(()=>"");
    if (text) dbEditor?.commands.insertContent(text);
  };
  const editorPastePlain = async () => {
    const text = await navigator.clipboard.readText().catch(()=>"");
    if (text) dbEditor?.chain().focus().insertContent(text).run();
  };
  const editorSelectAll  = () => dbEditor?.chain().focus().selectAll().run();
  const editorHighlight  = () => dbEditor?.chain().focus().toggleHighlight({ color:"#fef08a" }).run();
  const editorTextColor  = () => {
    const color = window.prompt("Text color (hex):", "#ef4444");
    if (color) dbEditor?.chain().focus().setColor(color).run();
  };

  // ── Menu builders ─────────────────────────────────────
  // Each returns MenuItem[]. Adding a new item = one line.

  const buildNoteMenu = (note: Note, mx: number, my: number): MenuItem[] => [
    { type:"item", label:"Open", onClick: () => selectNote(note.id) },
    { type:"sep" },
    { type:"item", label: note.pinned ? "Unpin" : "Pin", onClick: () => handleCtxPin(note) },
    { type:"item", label: note.follow_up_date ? "Edit Follow Up" : "Follow Up...", onClick: () => handleCtxFollowUp(note, mx, my) },
    { type:"item", label:"Duplicate", shortcut:"Ctrl+D", onClick: () => handleCtxDuplicate(note) },
    { type:"item", label:"Archive", onClick: () => handleCtxArchive(note) },
    { type:"sep" },
    { type:"item", label:"Rename", shortcut:"F2", onClick: () => handleCtxRename(note) },
    { type:"sep" },
    { type:"item", label:"Delete...", shortcut:"Del", danger:true, onClick: () => setDeleteConfirm({ id:note.id, label:firstLine(note.text), permanent:true }) },
  ];

  const buildArchivedMenu = (note: Note): MenuItem[] => [
    { type:"item", label:"Open",    onClick: () => selectNote(note.id) },
    { type:"item", label:"Restore", onClick: () => handleRestoreNote(note.id) },
    { type:"item", label:"Duplicate", shortcut:"Ctrl+D", onClick: () => handleCtxDuplicate(note) },
    { type:"sep" },
    { type:"item", label:"Delete Permanently...", danger:true, onClick: () => setDeleteConfirm({ id:note.id, label:firstLine(note.text), permanent:true }) },
  ];

  const buildEmptyMenu = (): MenuItem[] => [
    { type:"item", label:"New Note", shortcut:"Ctrl+N", onClick: createNoteRef.current },
    { type:"item", label:"Paste",    shortcut:"Ctrl+V", onClick: handleEmptyPaste },
    { type:"sep" },
    { type:"item", label:"Refresh",  onClick: refreshNotes },
  ];

  const buildEditorMenu = (): MenuItem[] => [
    { type:"item", label:"Undo",     shortcut:"Ctrl+Z",         onClick: editorUndo, disabled:!dbEditor?.can().undo() },
    { type:"item", label:"Redo",     shortcut:"Ctrl+Shift+Z",   onClick: editorRedo, disabled:!dbEditor?.can().redo() },
    { type:"sep" },
    { type:"item", label:"Cut",      shortcut:"Ctrl+X",         onClick: editorCut },
    { type:"item", label:"Copy",     shortcut:"Ctrl+C",         onClick: editorCopy },
    { type:"item", label:"Paste",    shortcut:"Ctrl+V",         onClick: editorPaste },
    { type:"item", label:"Paste Without Formatting", shortcut:"Ctrl+Shift+V", onClick: editorPastePlain },
    { type:"sep" },
    { type:"item", label:"Select All", shortcut:"Ctrl+A",       onClick: editorSelectAll },
    { type:"sep" },
    { type:"item", label:"Highlight",                            onClick: editorHighlight },
    { type:"item", label:"Text Color...",                        onClick: editorTextColor },
  ];

  // ── Context menu event handlers ───────────────────────

  const handleNoteContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling to empty-list handler
    if (note.status !== "archived") selectNoteKeyboard(note.id);
    const w = note.status === "archived" ? 200 : 210;
    const pos = clampMenu(e.clientX, e.clientY, w, 310);
    setCtxMenu({ kind:"note", note, x:pos.x, y:pos.y });
  };

  const handleListContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pos = clampMenu(e.clientX, e.clientY, 190, 130);
    setCtxMenu({ kind:"empty", x:pos.x, y:pos.y });
  };

  const handleEditorPanelContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".db-editor-header")) return;
    e.preventDefault();
    const pos = clampMenu(e.clientX, e.clientY, 260, 310);
    setCtxMenu({ kind:"editor", x:pos.x, y:pos.y });
  };

  // ── renderMenuItems ────────────────────────────────────
  // Wrapper always closes the menu before calling onClick.

  const closeCtx = () => setCtxMenu(null);

  const renderMenuItems = (items: MenuItem[]) =>
    items.map((item, i) =>
      item.type === "sep" ? (
        <div key={i} className="db-ctx-sep" />
      ) : (
        <button
          key={i}
          className={[
            "db-ctx-item",
            item.danger    ? "db-ctx-item--danger"   : "",
            item.disabled  ? "db-ctx-item--disabled" : "",
          ].filter(Boolean).join(" ")}
          onClick={item.disabled ? undefined : () => { closeCtx(); item.onClick(); }}
        >
          <span className="db-ctx-item-label">{item.label}</span>
          {item.shortcut && <span className="db-ctx-item-shortcut">{item.shortcut}</span>}
        </button>
      )
    );

  // ── View-scoped filtering + search ───────────────────

  const query = search.trim();

  const viewNotes: Note[] = useMemo(() => {
    switch (activeView) {
      case "all":              return sortNotes(notes);
      case "pinned":           return sortNotes(notes.filter(n => n.pinned));
      case "follow-up":        return sortNotes(notes.filter(n => !!n.follow_up_date));
      case "archived":         return [...archivedNotes].sort((a,b) => b.updated_at-a.updated_at);
      case "recently-edited":  return [...notes].sort((a,b) => b.updated_at-a.updated_at);
      case "recently-created": return [...notes].sort((a,b) => b.created_at-a.created_at);
    }
  }, [notes, archivedNotes, activeView]);

  const viewIndex = useMemo<SearchableNote[]>(
    () => viewNotes.map(n => ({ id:n.id, title:firstLine(n.text), body:htmlToPlain(n.text), updated_at:n.updated_at })),
    [viewNotes]
  );

  const displayNotes: Note[] = useMemo(() => {
    if (!query) return viewNotes;
    const ids = searchNotes(viewIndex, query);
    const map = new Map(viewNotes.map(n => [n.id, n]));
    return ids.map(id => map.get(id)).filter(Boolean) as Note[];
  }, [viewNotes, viewIndex, query]);

  const showDraft = !!(
    draft.trim() &&
    (activeView === "all" || activeView === "recently-edited") &&
    (!query || htmlToPlain(draft).toLowerCase().includes(query.toLowerCase()))
  );
  const isArchiveView  = activeView === "archived";
  const editorDisabled = selectedId === undefined;

  // ── List keyboard handler ─────────────────────────────

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isArchiveView) return;
    const vis: (string|null)[] = [...(showDraft ? [null as null] : []), ...displayNotes.map(n=>n.id)];
    const cur = selectedId===undefined ? -1 : vis.indexOf(selectedId as string|null);
    switch (e.key) {
      case "ArrowDown": { e.preventDefault(); const nxt=Math.min(cur+1,vis.length-1); if(nxt>=0&&nxt!==cur) selectNoteKeyboard(vis[nxt]); break; }
      case "ArrowUp":   { e.preventDefault(); const prv=Math.max(cur-1,0); if(prv>=0&&prv<vis.length&&prv!==cur) selectNoteKeyboard(vis[prv]); break; }
      case "Enter":     { e.preventDefault(); if (!editorDisabled) editorRef.current?.focus(); break; }
      case "F2":        { if (typeof selectedId==="string") { e.preventDefault(); const n=notes.find(x=>x.id===selectedId); if(n) handleCtxRename(n); } break; }
      case "Delete":
      case "Backspace": { e.preventDefault(); deleteNoteRef.current(); break; }
    }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (search) setSearch(""); else { (e.target as HTMLInputElement).blur(); editorRef.current?.focus(); }
  };

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
        <div className="cap-winctrl-group" data-tauri-no-drag style={{ marginLeft:"auto" }}>
          <button className="cap-winctrl cap-winctrl--min" onClick={()=>appWindow.minimize()} title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" rx="0.5" fill="currentColor"/></svg>
          </button>
          <button className="cap-winctrl cap-winctrl--max" onClick={()=>appWindow.toggleMaximize()} title="Maximize">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className="cap-winctrl cap-winctrl--close" onClick={()=>appWindow.hide()} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
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

            <div className="db-list-header" ref={listHeaderRef}>
              <button className="db-view-trigger" onClick={openViewDropdown}>
                <span>{VIEW_LABELS[activeView]}</span>
                <ChevronDown size={11} strokeWidth={2.5} className="db-view-chevron" />
              </button>
              {!isArchiveView && (
                <button className="db-list-add-btn" onClick={createNewNote} title="New note (Ctrl+N)">
                  <Plus size={14} strokeWidth={2} />
                </button>
              )}
            </div>

            <div
              className="db-cards"
              tabIndex={0}
              ref={listRef}
              onKeyDown={onListKeyDown}
              onContextMenu={handleListContextMenu}
            >
              {/* Draft */}
              {showDraft && (
                <button
                  ref={el => { if(el) cardRefs.current.set(null,el); else cardRefs.current.delete(null); }}
                  className={`db-card db-card-draft${selectedId===null ? " db-card-selected":""}`}
                  onClick={()=>selectNote(null)}
                >
                  <span className="db-card-title"><HighlightedText text={firstLine(draft)} query={query}/></span>
                  <div className="db-card-meta">
                    <span className="db-active-dot" title="Active in Capture"/>
                    <span className="db-card-date">Capture</span>
                  </div>
                </button>
              )}

              {/* Note rows */}
              {displayNotes.map(note => (
                <button
                  key={note.id}
                  ref={el => { if(!isArchiveView){ if(el) cardRefs.current.set(note.id,el); else cardRefs.current.delete(note.id); } }}
                  className={`db-card${!isArchiveView && selectedId===note.id ? " db-card-selected":""}`}
                  onClick={()=>{ if(!isArchiveView) selectNote(note.id); }}
                  onContextMenu={e => handleNoteContextMenu(e, note)}
                >
                  <span className="db-card-title">
                    {isArchiveView ? firstLine(note.text) : <HighlightedText text={firstLine(note.text)} query={query}/>}
                  </span>
                  <div className="db-card-meta">
                    {note.pinned && <Pin size={9} strokeWidth={2.5} className="db-icon-pin"/>}
                    {note.follow_up_date && <Calendar size={9} strokeWidth={2.5} className="db-icon-cal"/>}
                    <span className="db-card-date">{smartDate(note.updated_at)}</span>
                  </div>
                </button>
              ))}

              {/* Empty states */}
              {!showDraft && displayNotes.length === 0 && (
                <div className="db-empty">
                  {query ? (
                    <><div className="db-empty-title">No notes found</div><div className="db-empty-hint">Try searching titles or note contents.</div></>
                  ) : isArchiveView ? (
                    <><div className="db-empty-title">Archive is empty</div><div className="db-empty-hint">Archived notes appear here.</div></>
                  ) : (
                    <div className="db-empty-title">No notes in this view.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Editor panel ── */}
          <div className="db-editor-panel" onContextMenu={handleEditorPanelContextMenu}>
            <div className="db-editor-header">
              <input
                ref={searchRef}
                className="db-search"
                type="text"
                placeholder={`Search ${VIEW_LABELS[activeView].toLowerCase()}...`}
                value={search}
                onChange={e=>setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </div>
            <RichEditor
              ref={editorRef}
              onChange={handleEditorChange}
              disabled={editorDisabled}
              hideToolbar={true}
              onEditorReady={e=>setDbEditor(e)}
              onZoomChange={z=>setDbZoom(z)}
              onEscape={()=>listRef.current?.focus()}
              searchQuery={query}
            />
          </div>

        </div>
      </div>

      {/* ── View selector dropdown ── */}
      {viewDropdownOpen && viewDropdownRect && (
        <>
          <div className="db-overlay" onClick={()=>setViewDropdownOpen(false)}/>
          <div className="db-view-dropdown" style={{ left:viewDropdownRect.left, top:viewDropdownRect.top, width:viewDropdownRect.width }}>
            {(["all","pinned","follow-up","archived"] as ActiveView[]).map(v=>(
              <button key={v} className={`db-view-item${activeView===v?" db-view-item--active":""}`} onClick={()=>switchView(v)}>
                <span>{VIEW_LABELS[v]}</span>
                {activeView===v && <Check size={11} strokeWidth={2.5}/>}
              </button>
            ))}
            <div className="db-ctx-sep" style={{ margin:"3px 4px" }}/>
            {(["recently-edited","recently-created"] as ActiveView[]).map(v=>(
              <button key={v} className={`db-view-item${activeView===v?" db-view-item--active":""}`} onClick={()=>switchView(v)}>
                <span>{VIEW_LABELS[v]}</span>
                {activeView===v && <Check size={11} strokeWidth={2.5}/>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Context menu (all kinds) ── */}
      {ctxMenu && (
        <>
          <div className="db-overlay" onClick={closeCtx}/>
          <div
            className="db-ctx-menu"
            style={{
              left: ctxMenu.x,
              top:  ctxMenu.y,
              minWidth: ctxMenu.kind === "editor" ? 260 : ctxMenu.kind === "empty" ? 190 : ctxMenu.kind === "note" && ctxMenu.note.status === "archived" ? 200 : 210,
            }}
          >
            {ctxMenu.kind === "note" && (
              ctxMenu.note.status === "archived"
                ? renderMenuItems(buildArchivedMenu(ctxMenu.note))
                : renderMenuItems(buildNoteMenu(ctxMenu.note, ctxMenu.x, ctxMenu.y))
            )}
            {ctxMenu.kind === "empty"  && renderMenuItems(buildEmptyMenu())}
            {ctxMenu.kind === "editor" && renderMenuItems(buildEditorMenu())}
          </div>
        </>
      )}

      {/* ── Follow-up calendar ── */}
      {followUpPicker && (
        <>
          <div className="db-overlay" onClick={()=>setFollowUpPicker(null)}/>
          <DbCalendarPicker
            x={followUpPicker.x} y={followUpPicker.y}
            currentDate={followUpPicker.currentDate}
            onSelect={handleFollowUpSelect}
            onClose={()=>setFollowUpPicker(null)}
          />
        </>
      )}

      {/* ── Delete confirmation dialog ── */}
      {deleteConfirm && (
        <>
          <div className="db-dialog-overlay" onClick={()=>setDeleteConfirm(null)}/>
          <div className="db-dialog">
            <div className="db-dialog-title">Delete note?</div>
            <div className="db-dialog-body">
              <strong>"{deleteConfirm.label}"</strong> will be permanently deleted and cannot be recovered.
            </div>
            <div className="db-dialog-actions">
              <button className="db-dialog-btn" onClick={()=>setDeleteConfirm(null)}>Cancel</button>
              <button className="db-dialog-btn db-dialog-btn--danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

// ─── Inline text highlighter ─────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const lq=query.toLowerCase(), lt=text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last=0, key=0, idx=lt.indexOf(lq);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last,idx));
    parts.push(<mark key={key++} className="search-highlight">{text.slice(idx,idx+query.length)}</mark>);
    last=idx+query.length; idx=lt.indexOf(lq,last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// ─── Follow-up calendar ──────────────────────────────────

interface DbCalendarProps {
  x: number; y: number;
  currentDate: string|undefined;
  onSelect: (d: Date|null)=>void;
  onClose: ()=>void;
}

function DbCalendarPicker({ x, y, currentDate, onSelect, onClose }: DbCalendarProps) {
  const sel = currentDate ? new Date(currentDate+"T12:00:00") : null;
  const today = new Date();
  const [viewYear, setViewYear]   = useState(sel?.getFullYear()  ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(sel?.getMonth()     ?? today.getMonth());

  const prev = () => viewMonth===0 ? (setViewMonth(11),setViewYear(y=>y-1)) : setViewMonth(m=>m-1);
  const next = () => viewMonth===11? (setViewMonth(0), setViewYear(y=>y+1)) : setViewMonth(m=>m+1);

  const firstDow = new Date(viewYear,viewMonth,1).getDay();
  const days     = new Date(viewYear,viewMonth+1,0).getDate();
  const isToday  = (d:number) => today.getFullYear()===viewYear && today.getMonth()===viewMonth && today.getDate()===d;
  const isSel    = (d:number) => !!sel && sel.getFullYear()===viewYear && sel.getMonth()===viewMonth && sel.getDate()===d;
  const cells: (number|null)[] = [...Array(firstDow).fill(null), ...Array.from({length:days},(_,i)=>i+1)];

  return (
    <div className="db-cal-pop" style={{ left:x, top:y }}>
      <div className="db-cal-header">
        <button className="db-cal-nav" onMouseDown={e=>{e.preventDefault();prev()}}><ChevronLeft size={13} strokeWidth={2}/></button>
        <span className="db-cal-title">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className="db-cal-nav" onMouseDown={e=>{e.preventDefault();next()}}><ChevronRight size={13} strokeWidth={2}/></button>
      </div>
      <div className="db-cal-grid">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} className="db-cal-dow">{d}</div>)}
        {cells.map((d,i) => d===null ? <div key={`e${i}`}/> : (
          <button key={`d${i}`}
            className={["db-cal-day",isToday(d)?"db-cal-day--today":"",isSel(d)?"db-cal-day--selected":""].filter(Boolean).join(" ")}
            onMouseDown={e=>{e.preventDefault();onSelect(new Date(viewYear,viewMonth,d));onClose();}}>
            {d}
          </button>
        ))}
      </div>
      {sel && (
        <div className="db-cal-footer">
          <button className="db-cal-clear" onMouseDown={e=>{e.preventDefault();onSelect(null);onClose();}}>Clear date</button>
        </div>
      )}
    </div>
  );
}

export default Database;
