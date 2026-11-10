/** 「主题输入框」：输入主题关键词（PRD 命名表组件）。 */

interface ThemeInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function ThemeInput({ value, onChange }: ThemeInputProps) {
  return (
    <label className="theme-input">
      <span className="theme-input-label">主题关键词</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例如：春日通勤穿搭"
      />
    </label>
  );
}
