import "@/shared/styles.css";
import { render } from "solid-js/web";
import { App } from "./App";
import { DEFAULT_VIEW_ID } from "./views-registry";

const root = document.getElementById("root");
if (root) {
  const viewId = root.dataset.view ?? DEFAULT_VIEW_ID;
  render(() => <App viewId={viewId} />, root);
}
