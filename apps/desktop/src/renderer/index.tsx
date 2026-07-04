import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "@novel-studio/ui/styles.css";

const rootElement = document.getElementById("root");

if (rootElement !== null) {
  createRoot(rootElement).render(<App />);
}
