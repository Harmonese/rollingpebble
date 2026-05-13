import * as React from "react";
import { AboutPanel } from "../features/about/AboutPanel.js";
import { SettingsPanel } from "../features/settings/SettingsPanel.js";
import { AppProvider } from "./app.context.js";
import { Content } from "./content.js";
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { Toast } from "./toast.js";

export const App: React.FC = () => {
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [aboutOpen, setAboutOpen] = React.useState(false);
    return (
        <React.StrictMode>
            <AppProvider>
                <Header onAbout={() => setAboutOpen(true)} onSettings={() => setSettingsOpen(true)} />
                <Content />
                <Footer />
                <Toast />
                <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
                <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </AppProvider>
        </React.StrictMode>
    );
};
