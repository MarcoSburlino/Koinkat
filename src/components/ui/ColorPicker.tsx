import { ACCOUNT_COLORS } from '../../domain/colors';
import { Check } from 'lucide-react';

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
        Color
      </span>
      <div className="flex gap-2 flex-wrap">
        {ACCOUNT_COLORS.map((color) => (
          <button
            key={color.slug}
            type="button"
            onClick={() => onChange(color.hex)}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 cursor-pointer"
            style={{
              backgroundColor: color.hex,
              border:
                value.toLowerCase() === color.hex.toLowerCase()
                  ? '2px solid var(--text)'
                  : '2px solid transparent',
            }}
            title={color.label}
            aria-label={color.label}
          >
            {value.toLowerCase() === color.hex.toLowerCase() && (
              <Check size={16} color="#ffffff" strokeWidth={3} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
