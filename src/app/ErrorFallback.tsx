export function ErrorFallback(error: Error, reset: () => void) {
  const stack = () => (error.stack ?? "Нет стека вызовов").trim();
  return (
    <div class="error-fallback">
      <div class="error-fallback__content">
        <h2 class="error-fallback__title">Произошла ошибка</h2>
        <p class="error-fallback__message">{error.message}</p>
        <pre class="error-fallback__stack" aria-label="Стек вызовов">
          {stack()}
        </pre>
        <button
          type="button"
          class="error-fallback__btn"
          onClick={reset}
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}
