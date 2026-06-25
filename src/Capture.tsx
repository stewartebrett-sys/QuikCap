import "./Capture.css";
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const DRAFT_DEBOUNCE_MS = 300;

function Capture() {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  useEffect(() => {
    invoke<string>("load_draft").then((draft) => {
      if (editorRef.current && draft) {
        editorRef.current.value = draft;
      }
    });

    focusEditor();

    const unlistenPromise = listen("focus-editor", focusEditor);

    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWindow().hide();
      }
    };

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      clearTimeout(draftTimer.current);
      unlistenPromise.then((unlisten) => unlisten());
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      invoke("save_draft", { text }).catch(console.error);
    }, DRAFT_DEBOUNCE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();

      const text = editorRef.current?.value ?? "";
      if (!text.trim()) return;

      if (editorRef.current) editorRef.current.value = "";

      clearTimeout(draftTimer.current);

      invoke("finish_note", { text }).catch(console.error);

      // Hide immediately — same instant behavior as Escape.
      getCurrentWindow().hide();
    }
  };

  return (
    <div className="app">
      <textarea
        ref={editorRef}
        className="editor"
        spellCheck={false}
        placeholder=""
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

export default Capture;
