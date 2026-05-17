type Option = { value: string; label: string; disabled?: boolean };

export const optionNodes = (
    options: Option[],
    tr?: (key: string) => string,
) =>
    options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
            {tr ? tr(option.label) : option.label}
        </option>
    ));
