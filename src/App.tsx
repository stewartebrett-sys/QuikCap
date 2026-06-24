import "./App.css";
import { useEffect, useRef } from "react";
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

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
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
