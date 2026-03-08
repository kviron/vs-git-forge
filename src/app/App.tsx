/**
 * Оболочка приложения webview: ErrorBoundary + выбранное представление по viewId.
 * Используется в единственной точке входа (webview-main); viewId приходит из data-view.
 */
import { ErrorBoundary } from "solid-js";
import { Dynamic } from "solid-js/web";
import { ErrorFallback } from "./ErrorFallback";
import {
  getViewComponent,
  DEFAULT_VIEW_ID,
  type ViewId,
} from "./views-registry";

export interface AppProps {
  /** Идентификатор представления (из data-view). По умолчанию — git-forge. */
  viewId?: string;
}

function UnknownView(props: { viewId: string }) {
  return (
    <div style="padding: 1rem; color: var(--vscode-errorForeground);">
      Unknown view: {props.viewId}
    </div>
  );
}

export function App(props: AppProps) {
  const viewId = () => (props.viewId ?? DEFAULT_VIEW_ID) as ViewId;
  const component = () => getViewComponent(viewId()) ?? UnknownView;

  return (
    <ErrorBoundary
      fallback={(error, reset) => ErrorFallback(error, reset)}
    >
      {component() === UnknownView ? (
        <UnknownView viewId={viewId()} />
      ) : (
        <Dynamic component={component()!} viewId={viewId()} />
      )}
    </ErrorBoundary>
  );
}
