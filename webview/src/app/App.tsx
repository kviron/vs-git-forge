import { SelectedBranchProvider } from '../shared/context/SelectedBranchContext';
import { GitViewPage } from '../pages/git-view';

export function App() {
  return (
    <SelectedBranchProvider>
      <GitViewPage />
    </SelectedBranchProvider>
  );
}
