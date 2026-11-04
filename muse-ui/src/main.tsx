import ReactDOM from "react-dom/client";
import { App } from "./app/App.tsx";
import { InteractionProvider } from "./interaction/store.tsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <InteractionProvider>
    <App />
  </InteractionProvider>,
);
