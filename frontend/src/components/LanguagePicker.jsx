export default function LanguagePicker({
    languages,
    language,
    onLanguageChange,
}) {
    return (
        <select
            className="config-select"
            value={language}
            onChange={e => onLanguageChange(e.target.value)}
        >
            {languages.map(lang => (
                <option key={lang} value={lang}>
                    {lang.toUpperCase()}
                </option>
            ))}
        </select>
    );
}