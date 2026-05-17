import * as React from "react";
import { AboutPanel } from "../features/about/AboutPanel.js";
import { SettingsPanel } from "../features/settings/SettingsPanel.js";
import { AppProvider, AudioContext } from "./app.context.js";
import { Content } from "./content.js";
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { Toast } from "./toast.js";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    render() {
        if (this.state.error) {
            return React.createElement("div", {
                style: { color: "#ff6f6f", background: "#0e1113", padding: 40, fontFamily: "monospace", whiteSpace: "pre-wrap", minHeight: "100vh" }
            }, "APP CRASH: " + this.state.error.message + "\n\n" + this.state.error.stack);
        }
        return this.props.children;
    }
}

export const App: React.FC = () => {
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [aboutOpen, setAboutOpen] = React.useState(false);
    const audioElRef = React.useRef<HTMLAudioElement>(null);
    return (
        <React.StrictMode>
            <ErrorBoundary>
                <AudioContext.Provider value={audioElRef}>
                <AppProvider>
                    <Header onAbout={() => setAboutOpen(true)} onSettings={() => setSettingsOpen(true)} />
                    <Content />
                    <Footer />
                    <Toast />
                    <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
                    <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
                </AppProvider>
                </AudioContext.Provider>
            </ErrorBoundary>
        </React.StrictMode>
    );
};
