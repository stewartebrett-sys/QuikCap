import "./App.css";
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

function App() {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  useEffect(() => {
    focusEditor();

    const unlistenPromise = listen("focus-editor", () => {
      focusEditor();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWindow().hide();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="app">
      <textarea
        ref={editorRef}
        className="editor"
        spellCheck={false}
        placeholder=""
      />
    </div>
  );
}

export default App;
