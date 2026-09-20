import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { radioGroupKeys, radioTabIndex } from '@/lib/radioGroup';
import { useThemeMode, type ThemeMode } from '@/lib/theme';
import { tr } from '@/strings/tr';

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
  { mode: 'system', label: tr.theme.system, icon: Monitor },
  { mode: 'light', label: tr.theme.light, icon: Sun },
  { mode: 'dark', label: tr.theme.dark, icon: Moon },
];

/** "Görünüm": Sistem / Açık / Koyu. Applies at once and is remembered on this device. */
export function ThemeSetting() {
  const [mode, setMode] = useThemeMode();
  return (
    <Card className="flex flex-col gap-3">
      <h2 id="theme-heading" className="font-semibold">
        {tr.theme.title}
      </h2>
      <div role="radiogroup" aria-labelledby="theme-heading" onKeyDown={radioGroupKeys({ activate: true })} className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ mode: option, label, icon: Icon }, index) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            tabIndex={radioTabIndex(mode === option, true, index)}
            onClick={() => setMode(option)}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 text-sm font-bold',
              mode === option ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted',
            )}
          >
            <Icon aria-hidden="true" size={20} />
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}
