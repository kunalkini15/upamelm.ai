/**
 * @file main.tsx
 * @module muse-ui/main
 * @description Application bootstrap entry point. Mounts the root React DOM tree
 * wrapped in the central InteractionProvider state store.
 */

import ReactDOM from "react-dom/client";
import { App } from "./app/App.tsx";
import { InteractionProvider } from "./interaction/store.tsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <InteractionProvider>
    <App />
  </InteractionProvider>,
);
