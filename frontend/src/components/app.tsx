import * as React from "react";
import { SettingsPanel } from "../features/settings/SettingsPanel.js";
import { AppProvider } from "./app.context.js";
import { Content } from "./content.js";
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { Toast } from "./toast.js";

export const App: React.FC = () => {
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    return (
        <React.StrictMode>
            <AppProvider>
                <Header onSettings={() => setSettingsOpen(true)} />
                <Content />
                <Footer />
                <Toast />
                <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </AppProvider>
        </React.StrictMode>
    );
};
