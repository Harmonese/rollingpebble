export const Panel: React.FC<React.HTMLAttributes<HTMLElement> & { title?: React.ReactNode }> = (
    { title, className = "", children, ...props },
) => (
    <section className={`ui-panel${className ? ` ${className}` : ""}`} {...props}>
        {title && <h2 className="ui-panel-title">{title}</h2>}
        {children}
    </section>
);

export const SectionTitle: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
    <div className={`ui-section-title${className ? ` ${className}` : ""}`} {...props} />
);
