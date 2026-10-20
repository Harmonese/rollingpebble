import * as React from "react";
import { AboutPanel } from "../features/about/AboutPanel.js";
import { SettingsPanel } from "../features/settings/SettingsPanel.js";
import { audioElementContext } from "../shared/audioElementContext.js";
import { ConfirmProvider } from "../ui/ConfirmDialog.js";
import { Toast } from "../ui/Toast.js";
import { AppProvider } from "./AppContext.js";
import { Footer } from "./Footer.js";
import { Header } from "./Header.js";
import { StartupGate } from "./StartupGate.js";
import { ThemeEffects } from "./ThemeEffects.js";
import { WorkspaceShell } from "./WorkspaceShell.js";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return React.createElement("div", {
                style: {
                    color: "#ff6f6f",
                    background: "#0e1113",
                    padding: 40,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    minHeight: "100vh",
                },
            }, "APP CRASH: " + this.state.error.message + "\n\n" + this.state.error.stack);
        }
        return this.props.children;
    }
}

export const App: React.FC = () => {
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [settingsSection, setSettingsSection] = React.useState<"autoTiming" | "translation" | undefined>();
    React.useEffect(() => {
        const open = () => {
            setSettingsSection("translation");
            setSettingsOpen(true);
        };
        const openTiming = () => {
            setSettingsSection("autoTiming");
            setSettingsOpen(true);
        };
        window.addEventListener("rollingpebble:translation-settings", open);
        window.addEventListener("rollingpebble:auto-timing-settings", openTiming);
        return () => {
            window.removeEventListener("rollingpebble:translation-settings", open);
            window.removeEventListener("rollingpebble:auto-timing-settings", openTiming);
        };
    }, []);
    const [aboutOpen, setAboutOpen] = React.useState(false);
    const audioElRef = React.useRef<HTMLAudioElement>(null);
    return (
        <React.StrictMode>
            <ErrorBoundary>
                <audioElementContext.Provider value={audioElRef}>
                    <AppProvider>
                        <ConfirmProvider>
                            <ThemeEffects />
                            <StartupGate
                                onSettings={() => {
                                    setSettingsSection("autoTiming");
                                    setSettingsOpen(true);
                                }}
                            >
                                <Header
                                    onAbout={() => setAboutOpen(true)}
                                    onSettings={() => {
                                        setSettingsSection(undefined);
                                        setSettingsOpen(true);
                                    }}
                                />
                                <WorkspaceShell />
                                <Footer />
                                <Toast />
                                <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
                                <SettingsPanel
                                    open={settingsOpen}
                                    initialSection={settingsSection}
                                    onClose={() => setSettingsOpen(false)}
                                />
                            </StartupGate>
                        </ConfirmProvider>
                    </AppProvider>
                </audioElementContext.Provider>
            </ErrorBoundary>
        </React.StrictMode>
    );
};
