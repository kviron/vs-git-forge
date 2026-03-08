/**
 * Обёртка представления «Git Forge»: провайдеры контекста + страница.
 * Подключается в реестр представлений по id "git-forge".
 */
import { SelectedBranchProvider } from "@/shared/context/SelectedBranchContext";
import { GitViewPage } from "./ui/GitViewPage";

export function GitForgeView() {
  return (
    <SelectedBranchProvider>
      <GitViewPage />
    </SelectedBranchProvider>
  );
}
