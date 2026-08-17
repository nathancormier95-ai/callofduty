// Voltage Wilds visual system: this route is a full-screen tactical field, not a conventional page.
import ErrorBoundary from "./components/ErrorBoundary";
import GameCanvas from "./components/GameCanvas";

function App() {
  return (
    <ErrorBoundary>
      <GameCanvas />
    </ErrorBoundary>
  );
}

export default App;
