import { ErrorBoundary } from "solid-js";
import { SelectedBranchProvider } from "../shared/context/SelectedBranchContext";
import { GitViewPage } from "../pages/git-view";
import { ErrorFallback } from "./ErrorFallback";

export function App() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => ErrorFallback(error, reset)}
    >
      <SelectedBranchProvider>
        <GitViewPage />
      </SelectedBranchProvider>
    </ErrorBoundary>
  );
}
