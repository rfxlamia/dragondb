import { WelcomeAccessibility } from "./welcome-accessibility";
import { WelcomeCopy } from "./welcome-copy";
import "./welcome.css";

export type WelcomeViewProps = {
  onConnectToServer: () => void;
};

export function WelcomeView({ onConnectToServer }: WelcomeViewProps): React.JSX.Element {
  return (
    <section className="welcome-view" aria-label={WelcomeCopy.hello}>
      <img className="welcome-view__mascot" src="/onboarding.png" alt={WelcomeCopy.mascotAlt} />
      <h1 className="welcome-view__hello" data-testid={WelcomeAccessibility.hello}>
        {WelcomeCopy.hello}
      </h1>
      <button
        type="button"
        className="welcome-view__connect"
        data-testid={WelcomeAccessibility.connectToServer}
        onClick={onConnectToServer}
      >
        {WelcomeCopy.connectToServer}
      </button>
    </section>
  );
}
