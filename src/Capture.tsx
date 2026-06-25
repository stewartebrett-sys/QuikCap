import "./Capture.css";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const DRAFT_DEBOUNCE_MS = 300;

function Capture() {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    invoke<string>("load_draft").then((draft) => {
      if (editorRef.current && draft) {
        editorRef.current.value = draft;
      }
    });

    editorRef.current?.focus();

    const unlistenPromise = listen("focus-editor", () => {
      editorRef.current?.focus();
    });

    // Capture phase on window — fires before WKWebView's native text handlers
    // and before any React/element handler. This is the correct level for Escape.
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        console.log("[QuikCap] Escape — window capture phase");
        e.preventDefault();
        invoke("hide_capture").catch(console.error);
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);

    return () => {
      clearTimeout(draftTimer.current);
      unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleWindowKeyDown, true);
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
    if (e.key === "Escape") {
      // Belt-and-suspenders: catches Escape if the capture listener above somehow
      // doesn't fire (e.g. JS not fully initialised yet on first render).
      console.log("[QuikCap] Escape — textarea onKeyDown");
      e.preventDefault();
      invoke("hide_capture").catch(console.error);
      return;
    }

    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();

      const text = editorRef.current?.value ?? "";
      if (!text.trim()) return;

      if (editorRef.current) editorRef.current.value = "";

      clearTimeout(draftTimer.current);

      invoke("finish_note", { text }).catch(console.error);
      invoke("hide_capture").catch(console.error);
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
