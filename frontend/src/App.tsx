import './App.css';

/**
 * Корневой компонент SPA.
 * На этапе 1 — заглушка каркаса приложения; маршруты и auth
 * добавляются на этапе 2 (см. docs/design.md §2).
 */
function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>FitHome</h1>
        <p>Планирование домашних тренировок, тренировок на улице и в зале</p>
      </header>
      <main className="app-main">
        <div className="card">
          <h2>Каркас проекта готов</h2>
          <p>
            Этап 1 — архитектура и скелет. Интерфейс реализуется на этапах 2–5
            (см. <code>docs/design.md</code>).
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
