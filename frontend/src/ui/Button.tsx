type ButtonTone = "default" | "primary" | "danger" | "ghost";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: ButtonTone;
};

export const Button: React.FC<ButtonProps> = ({ tone = "default", className = "", ...props }) => (
    <button className={`ui-button ui-button-${tone}${className ? ` ${className}` : ""}`} type="button" {...props} />
);

export const IconButton: React.FC<ButtonProps> = ({ className = "", ...props }) => (
    <Button className={`ui-icon-button${className ? ` ${className}` : ""}`} {...props} />
);
